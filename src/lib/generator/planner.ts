import { schemaReviewNotes } from "./schema.ts";
import type {
    ApiHttpMethod,
    ApiMediaType,
    ApiModel,
    ApiOperation,
    ApiParameter,
    ApiResponse,
    ApiSecurityRequirement,
    ApiSecurityScheme,
} from "@/lib/api-model";
import type {
    ParamLocation,
    ToolAnnotations,
    ToolAuthPlan,
    ToolAuthRequirementPlan,
    ToolAuthSchemePlan,
    ToolManualReviewFlag,
    ToolPlan,
    ToolPlanParameter,
    ToolRequestBodyPlan,
    ToolSerializationPlan,
    ToolSerializedParameter,
} from "./types.ts";
import { getBodyContentKind, isBinarySchema, isShallowSimpleObjectSchema, makeUniqueIdentifier, toSafeIdentifier } from "./utils.ts";

function operationFallbackName(operation: ApiOperation): string {
    return `${operation.method.toLowerCase()}_${operation.path.replace(/[{}]/g, "")}`;
}

function getToolName(operation: ApiOperation, seen: Set<string>, index: number): string {
    const desired = operation.operationId || operation.source?.name || operation.summary || operationFallbackName(operation);
    return makeUniqueIdentifier(desired, seen, `tool_${index + 1}`);
}

function getDescription(operation: ApiOperation): string {
    if (operation.description?.trim()) return operation.description.trim();
    if (operation.summary?.trim()) return operation.summary.trim();
    return `${operation.method} ${operation.path}`;
}

// Derive MCP tool annotations (MCP 2025-11-25) from HTTP method semantics.
// These are advisory hints only. Verb -> annotation mapping:
//   GET / HEAD          -> read-only, idempotent, not destructive
//   PUT / DELETE        -> not read-only, idempotent, destructive
//   PATCH               -> not read-only, not idempotent, destructive
//   POST                -> not read-only, not idempotent, not destructive
//   (other verbs)       -> conservative: not read-only, not idempotent, not destructive
// openWorldHint is always true because generated tools call external HTTP APIs.
export function deriveToolAnnotations(method: ApiHttpMethod, title?: string): ToolAnnotations {
    const readOnly = method === "GET" || method === "HEAD";
    const idempotent = method === "GET" || method === "HEAD" || method === "PUT" || method === "DELETE";
    const destructive = method === "PUT" || method === "PATCH" || method === "DELETE";

    return {
        ...(title ? { title } : {}),
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        idempotentHint: idempotent,
        openWorldHint: true,
    };
}

// The MCP `title` is a human-friendly display name. Prefer the operation summary,
// falling back to the operationId; leave undefined when neither is present.
function getToolTitle(operation: ApiOperation): string | undefined {
    if (operation.summary?.trim()) return operation.summary.trim();
    if (operation.operationId?.trim()) return operation.operationId.trim();
    return undefined;
}

// Pick the success (2xx) response, preferring 200/201, then the lowest 2xx code.
function chooseSuccessResponse(operation: ApiOperation): ApiResponse | undefined {
    const successes = operation.responses.filter((response) => /^2\d\d$/.test(response.statusCode));
    if (successes.length === 0) return undefined;

    return successes.find((response) => response.statusCode === "200")
        || successes.find((response) => response.statusCode === "201")
        || successes.slice().sort((a, b) => a.statusCode.localeCompare(b.statusCode))[0];
}

// Choose the primary media type for a response body, preferring JSON. Mirrors
// chooseRequestMedia's preference order for consistency.
function chooseResponseMedia(response: ApiResponse | undefined): ApiMediaType | undefined {
    const content = response?.content || [];
    if (content.length === 0) return undefined;

    return content.find((media) => media.mediaType === "application/json")
        || content.find((media) => media.mediaType.includes("+json"))
        || content[0];
}

// Derive an MCP structured-output schema from the success response schema.
// Only available on the canonical (apiModel) path. Returns undefined when there
// is no usable 2xx response schema.
function deriveOutputSchema(operation: ApiOperation): Record<string, unknown> | undefined {
    const media = chooseResponseMedia(chooseSuccessResponse(operation));
    if (!media?.schema || Object.keys(media.schema).length === 0) return undefined;
    return media.schema;
}

function chooseRequestMedia(operation: ApiOperation): ApiMediaType | undefined {
    const content = operation.requestBody?.content || [];
    if (content.length === 0) return undefined;

    return content.find((media) => media.mediaType === "application/json")
        || content.find((media) => media.mediaType.includes("+json"))
        || content.find((media) => media.mediaType === "application/x-www-form-urlencoded")
        || content.find((media) => media.mediaType === "multipart/form-data")
        || content[0];
}

function isObjectWithNamedProperties(schema?: Record<string, unknown>): boolean {
    return Boolean(schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties));
}

function getSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
    return (schema.properties || {}) as Record<string, Record<string, unknown>>;
}

function getBodyParameterDescription(schema: Record<string, unknown>, contentKind: ToolRequestBodyPlan["contentKind"]): string {
    const description = typeof schema.description === "string" ? schema.description : "";
    if (contentKind !== "multipart" || !isBinarySchema(schema)) return description;

    const multipartDescription = "Base64-encoded file content.";
    return description ? `${description} ${multipartDescription}` : multipartDescription;
}

// Coarse JSON-Schema type for a parameter, derived once here so ToolPlan is the
// single source of truth. Flows through to GenerationParam.type unchanged.
function getParameterType(schema?: Record<string, unknown>): string {
    if (!schema) return "string";
    if (schema.type === "array") return "array";
    if (schema.type === "object" || schema.properties) return "object";
    return typeof schema.type === "string" ? schema.type : "string";
}

function buildParameterPlans(parameters: ApiParameter[], seenArgs: Set<string>): ToolPlanParameter[] {
    return parameters.map((parameter, index) => ({
        argName: makeUniqueIdentifier(parameter.name, seenArgs, `param_${index + 1}`),
        sourceName: parameter.name,
        type: getParameterType(parameter.schema),
        location: parameter.in,
        required: parameter.required,
        description: parameter.description || "",
        schema: parameter.schema,
        style: parameter.style,
        explode: parameter.explode,
    }));
}

function buildBodyParameterPlans(
    media: ApiMediaType | undefined,
    requiredBody: boolean,
    seenArgs: Set<string>,
    contentKind: ToolRequestBodyPlan["contentKind"]
): ToolPlanParameter[] {
    if (!media?.schema) return [];

    if (
        (contentKind === "flattenedObject" && isShallowSimpleObjectSchema(media.schema)) ||
        (["formUrlencoded", "multipart"].includes(contentKind || "") && isObjectWithNamedProperties(media.schema))
    ) {
        const requiredFields = new Set((media.schema.required || []) as string[]);
        return Object.entries(getSchemaProperties(media.schema)).map(([name, schema], index) => ({
            argName: makeUniqueIdentifier(name, seenArgs, `body_${index + 1}`),
            sourceName: name,
            type: getParameterType(schema),
            location: "body",
            required: requiredBody && requiredFields.has(name),
            description: getBodyParameterDescription(schema, contentKind),
            schema,
        }));
    }

    return [{
        argName: makeUniqueIdentifier("body", seenArgs, "body"),
        sourceName: "body",
        type: getParameterType(media.schema),
        location: "body",
        required: requiredBody,
        description: media.schema.description as string || "",
        schema: media.schema,
    }];
}

function buildInputSchema(parameters: ToolPlanParameter[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const parameter of parameters) {
        properties[parameter.argName] = {
            ...(parameter.schema || { type: "string" }),
            description: parameter.description || undefined,
        };

        if (parameter.required) {
            required.push(parameter.argName);
        }
    }

    return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
    };
}

function getEffectiveSecurity(operation: ApiOperation, apiModel: ApiModel): {
    source: ToolAuthPlan["source"];
    requirements: ApiSecurityRequirement[];
} {
    if (operation.security !== undefined) {
        return { source: "operation", requirements: operation.security };
    }

    return { source: apiModel.security.length > 0 ? "global" : "none", requirements: apiModel.security };
}

function getAuthStrategyFromScheme(
    schemeName: string,
    scheme: ApiSecurityScheme | undefined
): ToolAuthSchemePlan | undefined {
    if (!scheme) return undefined;

    if (scheme.type === "apiKey") {
        const location = scheme.in === "query"
            ? "query"
            : scheme.in === "cookie"
                ? "cookie"
                : "header";
        return {
            strategy: location === "query"
                ? "apiKeyQuery"
                : location === "cookie"
                    ? "apiKeyCookie"
                    : "apiKeyHeader",
            schemeName,
            apiKeyName: typeof scheme.name === "string" ? scheme.name : schemeName,
            apiKeyLocation: location,
        };
    }

    if (scheme.type === "http" && scheme.scheme === "bearer") {
        return { strategy: "bearer", schemeName };
    }

    if (scheme.type === "http" && scheme.scheme === "basic") {
        return { strategy: "basic", schemeName };
    }

    return undefined;
}

function pickPrimaryAuthPlan(
    source: ToolAuthPlan["source"],
    requirements: ToolAuthRequirementPlan[]
): ToolAuthPlan {
    const primaryRequirement = requirements[0];
    const primaryScheme = primaryRequirement?.schemes[0];

    if (!primaryScheme) {
        return {
            strategy: "none",
            source,
            requirement: primaryRequirement?.requirement,
            requirements,
        };
    }

    return {
        strategy: primaryScheme.strategy,
        source,
        schemeName: primaryScheme.schemeName,
        apiKeyName: primaryScheme.apiKeyName,
        apiKeyLocation: primaryScheme.apiKeyLocation,
        requirement: primaryRequirement.requirement,
        requirements,
    };
}

function buildAuthPlan(
    operation: ApiOperation,
    apiModel: ApiModel,
    warnings: string[],
    manualReview: ToolManualReviewFlag[]
): ToolAuthPlan {
    const { source, requirements } = getEffectiveSecurity(operation, apiModel);

    if (requirements.length === 0) {
        return { strategy: "none", source: source === "operation" ? "operation" : "none", requirements: [] };
    }

    const supportedRequirements: ToolAuthRequirementPlan[] = [];

    for (const requirement of requirements) {
        const schemes: ToolAuthSchemePlan[] = [];
        let hasUnsupportedScheme = false;
        const schemeNames = Object.keys(requirement);

        for (const schemeName of schemeNames) {
            const auth = getAuthStrategyFromScheme(schemeName, apiModel.securitySchemes[schemeName]);
            if (auth) {
                schemes.push(auth);
            } else {
                hasUnsupportedScheme = true;
            }
        }

        if (!hasUnsupportedScheme && schemes.length === schemeNames.length) {
            supportedRequirements.push({ requirement, schemes });
        }
    }

    if (supportedRequirements.length > 0) {
        if (supportedRequirements.length > 1) {
            warnings.push("Multiple alternative security requirements were found; generated clients will use the first fully configured alternative at runtime.");
        }

        return pickPrimaryAuthPlan(source, supportedRequirements);
    }

    manualReview.push({
        code: "unsupported-auth",
        severity: "warning",
        message: "No supported auth strategy could be inferred from this operation's security requirements.",
    });

    return { strategy: "none", source: "unsupported", requirement: requirements[0] };
}

function getRequestBodyStrategy(
    operation: ApiOperation,
    media: ApiMediaType | undefined
): ToolRequestBodyPlan {
    if (!media) {
        return { required: false };
    }

    const contentKind = getBodyContentKind(
        {
            endpointId: operation.id,
            enabled: true,
            toolName: operation.operationId || operation.summary || operation.id,
            description: getDescription(operation),
            parameters: [],
            bodySchema: media.schema,
            bodyContentType: media.mediaType,
        },
        []
    );

    return {
        required: operation.requestBody?.required || false,
        contentType: media.mediaType,
        contentKind,
        schema: media.schema,
    };
}

function serializeParameters(parameters: ToolPlanParameter[], location: Exclude<ParamLocation, "body">): ToolSerializedParameter[] {
    return parameters
        .filter((parameter) => parameter.location === location)
        .map((parameter) => ({
            argName: parameter.argName,
            sourceName: parameter.sourceName,
            required: parameter.required,
            style: parameter.style,
            explode: parameter.explode,
        }));
}

function buildSerializationStrategy(
    parameters: ToolPlanParameter[],
    requestBody: ToolRequestBodyPlan
): ToolSerializationPlan {
    const bodyParams = parameters.filter((parameter) => parameter.location === "body");

    return {
        path: serializeParameters(parameters, "path"),
        query: serializeParameters(parameters, "query"),
        header: serializeParameters(parameters, "header"),
        cookie: serializeParameters(parameters, "cookie"),
        requestBody: requestBody.contentType && requestBody.contentKind
            ? {
                contentType: requestBody.contentType,
                contentKind: requestBody.contentKind,
                parameterNames: bodyParams.map((parameter) => parameter.argName),
            }
            : undefined,
    };
}

function pushRequestBodyReviewFlags(
    requestBody: ToolRequestBodyPlan,
    manualReview: ToolManualReviewFlag[]
) {
    if (requestBody.contentKind === "binary") {
        manualReview.push({
            code: "binary-request-body",
            severity: "warning",
            message: "Binary request body serialization needs manual review for the target runtime.",
        });
    }

    if (requestBody.contentType && !requestBody.contentKind) {
        manualReview.push({
            code: "unknown-request-body",
            severity: "warning",
            message: `Request body content type "${requestBody.contentType}" could not be mapped to a serialization strategy.`,
        });
    }
}

export function planToolFromOperation(
    apiModel: ApiModel,
    operation: ApiOperation,
    options: { toolName?: string; description?: string; preferredContentType?: string; index?: number; seenToolNames?: Set<string> } = {}
): ToolPlan {
    const warnings: string[] = [];
    const manualReview: ToolManualReviewFlag[] = [];
    const seenArgs = new Set<string>();
    const toolName = options.toolName
        ? toSafeIdentifier(options.toolName, `tool_${(options.index || 0) + 1}`)
        : getToolName(operation, options.seenToolNames || new Set<string>(), options.index || 0);
    const media = options.preferredContentType
        ? operation.requestBody?.content.find((candidate) => candidate.mediaType === options.preferredContentType) || chooseRequestMedia(operation)
        : chooseRequestMedia(operation);
    const requestBodyStrategy = getRequestBodyStrategy(operation, media);
    const parameters = [
        ...buildParameterPlans(operation.parameters, seenArgs),
        ...buildBodyParameterPlans(media, operation.requestBody?.required || false, seenArgs, requestBodyStrategy.contentKind),
    ];

    pushRequestBodyReviewFlags(requestBodyStrategy, manualReview);

    warnings.push(...schemaReviewNotes({ parameters: operation.parameters, requestBody: operation.requestBody, responses: operation.responses }));
    const title = getToolTitle(operation);

    return {
        id: operation.id,
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        baseUrl: (operation.servers?.[0] || operation.pathServers?.[0] || apiModel.servers[0])?.resolvedUrl
            || (operation.servers?.[0] || operation.pathServers?.[0] || apiModel.servers[0])?.url
            || apiModel.baseUrls[0],
        toolName,
        title,
        inputSchema: buildInputSchema(parameters),
        outputSchema: deriveOutputSchema(operation),
        annotations: deriveToolAnnotations(operation.method, title),
        description: options.description?.trim() || getDescription(operation),
        authStrategy: buildAuthPlan(operation, apiModel, warnings, manualReview),
        requestBodyStrategy,
        serializationStrategy: buildSerializationStrategy(parameters, requestBodyStrategy),
        parameters,
        warnings,
        manualReview,
    };
}

export function buildToolPlans(apiModel: ApiModel): ToolPlan[] {
    const seenToolNames = new Set<string>();

    return apiModel.operations.map((operation, index) =>
        planToolFromOperation(apiModel, operation, { index, seenToolNames })
    );
}
