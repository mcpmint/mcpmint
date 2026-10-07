import {
    GENERATOR_CONTRACT_VERSION,
    GENERATOR_VERSION,
    type GenerationPlan,
    type GenerationTool,
    type GeneratorRequest,
    type GenerationParam,
    type GeneratorToolParameter,
    type ToolPlan,
    type ToolAuthPlan,
    type ToolAuthSchemePlan,
    type ToolPlanParameter,
} from "./types.ts";
import type { ApiModel, ApiOperation } from "@/lib/api-model";
import { planToolFromOperation } from "./planner.ts";
import {
    getDefaultFeatures,
    getTransportStrategy,
    makeUniqueIdentifier,
} from "./utils.ts";

function makeUniqueDisplayName(desired: string, existing: Set<string>, fallback: string): string {
    const base = desired.trim() || fallback;

    if (!existing.has(base)) {
        existing.add(base);
        return base;
    }

    let counter = 2;
    while (existing.has(`${base}_${counter}`)) {
        counter += 1;
    }

    const unique = `${base}_${counter}`;
    existing.add(unique);
    return unique;
}

function normalizeAuth(input: GeneratorRequest["authConfig"]): GenerationPlan["auth"] {
    if (input.type === "apiKey") {
        const location = input.apiKey?.in || "header";
        return {
            strategy: location === "query"
                ? "apiKeyQuery"
                : location === "cookie"
                    ? "apiKeyCookie"
                    : "apiKeyHeader",
            type: "apiKey",
            apiKeyName: input.apiKey?.name || "X-API-Key",
            apiKeyLocation: location,
        };
    }

    if (input.type === "bearer") {
        return { strategy: "bearer", type: input.type };
    }

    if (input.type === "basic") {
        return { strategy: "basic", type: input.type };
    }

    return { strategy: "none", type: input.type };
}

function normalizeMcpServerAuth(input?: GeneratorRequest["mcpServerAuthConfig"]): GenerationPlan["mcpServerAuth"] {
    return {
        type: input?.type || "none",
        tokenEnvVar: "MCP_AUTH_TOKEN",
        allowedOriginsEnvVar: "MCP_ALLOWED_ORIGINS",
        allowedOrigins: [...new Set((input?.allowedOrigins || []).map((origin) => origin.trim()).filter(Boolean))],
    };
}

function authPlanFromNormalizedAuth(auth: GenerationPlan["auth"]): ToolAuthPlan {
    if (auth.strategy === "none") {
        return { strategy: "none", source: "none", requirements: [] };
    }

    const schemeName = auth.strategy === "apiKeyHeader" || auth.strategy === "apiKeyQuery" || auth.strategy === "apiKeyCookie"
        ? "apiKey"
        : auth.strategy;
    const scheme: ToolAuthSchemePlan = {
        strategy: auth.strategy,
        schemeName,
        apiKeyName: auth.apiKeyName,
        apiKeyLocation: auth.apiKeyLocation,
    };
    const requirement = { [schemeName]: [] };

    return {
        strategy: auth.strategy,
        source: "global",
        schemeName,
        apiKeyName: auth.apiKeyName,
        apiKeyLocation: auth.apiKeyLocation,
        requirement,
        requirements: [{ requirement, schemes: [scheme] }],
    };
}

function mergeFallbackAuthPlan(toolAuth: ToolAuthPlan, fallbackAuth: GenerationPlan["auth"]): ToolAuthPlan {
    if (toolAuth.strategy !== "none" || toolAuth.source !== "none" || fallbackAuth.strategy === "none") {
        return toolAuth;
    }

    return authPlanFromNormalizedAuth(fallbackAuth);
}

function getCanonicalOperation(apiModel: ApiModel | undefined, endpointId: string): ApiOperation | undefined {
    return apiModel?.operations.find((operation) => operation.id === endpointId);
}

function findConfiguredParameter(
    planParameter: ToolPlanParameter,
    configuredParameters: GeneratorToolParameter[],
    warnings?: string[],
    toolName?: string
): GeneratorToolParameter | undefined {
    const matchesIdentity = (parameter: GeneratorToolParameter) =>
        parameter.originalName === planParameter.sourceName ||
        parameter.name === planParameter.sourceName ||
        parameter.name === planParameter.argName;
    const locationMatch = configuredParameters.find((parameter) =>
        parameter.location === planParameter.location && matchesIdentity(parameter)
    );

    if (locationMatch) {
        return locationMatch;
    }

    const explicitWrongLocationMatches = configuredParameters.filter((parameter) =>
        parameter.location !== undefined &&
        parameter.location !== planParameter.location &&
        matchesIdentity(parameter)
    );
    if (explicitWrongLocationMatches.length > 0) {
        warnings?.push(`Ignored UI parameter override with mismatched location for "${planParameter.sourceName}" in ${toolName || "tool"}`);
    }

    const fallbackMatches = configuredParameters.filter((parameter) =>
        parameter.location === undefined && matchesIdentity(parameter)
    );
    if (fallbackMatches.length === 1) {
        return fallbackMatches[0];
    }

    if (fallbackMatches.length > 1) {
        warnings?.push(`Ignored ambiguous UI parameter override for "${planParameter.sourceName}" in ${toolName || "tool"}`);
    }

    return undefined;
}

function isParameterHidden(
    planParameter: ToolPlanParameter,
    configuredParameters: GeneratorToolParameter[],
    warnings: string[],
    toolName: string
): boolean {
    if (!findConfiguredParameter(planParameter, configuredParameters)?.hidden) {
        return false;
    }

    if (planParameter.location === "path" && planParameter.required) {
        warnings.push(`Ignored hidden override for required path parameter "${planParameter.sourceName}" in ${toolName}`);
        return false;
    }

    return true;
}

function toGenerationToolFromToolPlan(
    toolPlan: ToolPlan,
    tool: GeneratorRequest["tools"][number],
    warnings: string[],
    fallbackAuth: GenerationPlan["auth"]
): GenerationTool {
    const seenArgs = new Set<string>();
    const visibleParameters = toolPlan.parameters.filter((parameter) =>
        !isParameterHidden(parameter, tool.parameters, warnings, toolPlan.toolName)
    );
    const params: GenerationParam[] = visibleParameters.map((parameter, parameterIndex) => {
        const configuredParameter = findConfiguredParameter(parameter, tool.parameters, warnings, toolPlan.toolName);
        const desired = configuredParameter?.name || parameter.argName;
        const argName = makeUniqueIdentifier(desired, seenArgs, `param_${parameterIndex + 1}`);

        if (argName !== desired) {
            warnings.push(`Normalized parameter "${desired}" to "${argName}" for ${toolPlan.toolName}`);
        }

        return {
            argName,
            sourceName: parameter.sourceName,
            // Type is derived once by the planner (ToolPlan is the single source of
            // truth); carry it through rather than re-deriving it from the schema here.
            type: parameter.type,
            required: parameter.required,
            description: configuredParameter?.description || parameter.description,
            location: parameter.location,
            schema: parameter.schema,
            style: parameter.style,
            explode: parameter.explode,
        };
    });
    const bodyParams = params.filter((param) => param.location === "body");
    const requestBody = toolPlan.requestBodyStrategy.contentKind
        ? {
            contentType: toolPlan.requestBodyStrategy.contentType || "application/json",
            contentKind: toolPlan.requestBodyStrategy.contentKind,
            schema: toolPlan.requestBodyStrategy.schema,
            params: bodyParams,
        }
        : undefined;

    warnings.push(...toolPlan.warnings);
    warnings.push(...toolPlan.manualReview.map((flag) => flag.message));

    return {
        id: toolPlan.id,
        displayName: toolPlan.toolName,
        functionName: makeUniqueIdentifier(toolPlan.toolName, new Set<string>(), "tool"),
        description: toolPlan.description,
        method: toolPlan.method as GenerationTool["method"],
        path: toolPlan.path,
        baseUrl: toolPlan.baseUrl,
        params,
        authStrategy: mergeFallbackAuthPlan(toolPlan.authStrategy, fallbackAuth),
        requestBody,
        title: toolPlan.title,
        outputSchema: toolPlan.outputSchema,
        annotations: toolPlan.annotations,
    };
}

function normalizeTool(
    tool: GeneratorRequest["tools"][number],
    toolIndex: number,
    warnings: string[],
    apiModel: ApiModel | undefined,
    fallbackAuth: GenerationPlan["auth"]
): GenerationTool {
    const canonicalOperation = getCanonicalOperation(apiModel, tool.endpointId);
    if (!apiModel || !canonicalOperation) {
        // The canonical (apiModel) path is the only supported path. Every tool must
        // resolve to an operation in the parsed API model; there is no heuristic
        // fallback for building a tool from an endpointId alone.
        throw new Error(
            `Cannot normalize tool "${tool.endpointId}": no matching operation found in the parsed API model. `
            + "A canonical apiModel with an operation whose id equals the tool's endpointId is required."
        );
    }

    const displayName = tool.toolName.trim() || `tool_${toolIndex + 1}`;

    if (displayName !== tool.toolName) {
        warnings.push(`Trimmed empty or padded tool name for ${tool.endpointId}`);
    }

    return toGenerationToolFromToolPlan(
        planToolFromOperation(apiModel, canonicalOperation, {
            toolName: displayName,
            description: tool.description,
            preferredContentType: tool.bodyContentType,
            index: toolIndex,
        }),
        tool,
        warnings,
        fallbackAuth
    );
}

export function buildGenerationPlan(request: GeneratorRequest): GenerationPlan {
    const warnings: string[] = [];
    const seenToolNames = new Set<string>();
    const seenFunctionNames = new Set<string>();
    const auth = normalizeAuth(request.authConfig);
    const mcpServerAuth = normalizeMcpServerAuth(request.mcpServerAuthConfig);

    const tools = request.tools.map((tool, index) => {
        const normalized = normalizeTool(tool, index, warnings, request.spec.apiModel, auth);
        const uniqueDisplayName = makeUniqueDisplayName(
            normalized.displayName,
            seenToolNames,
            `tool_${index + 1}`
        );
        const uniqueFunctionName = makeUniqueIdentifier(
            normalized.functionName,
            seenFunctionNames,
            `tool_${index + 1}`
        );

        if (uniqueDisplayName !== normalized.displayName) {
            warnings.push(`Renamed duplicate tool "${normalized.displayName}" to "${uniqueDisplayName}"`);
        }

        if (uniqueFunctionName !== normalized.functionName) {
            warnings.push(`Adjusted generated function name for "${normalized.displayName}" to "${uniqueFunctionName}"`);
        }

        return {
            ...normalized,
            baseUrl: normalized.baseUrl || request.spec.baseUrl,
            displayName: uniqueDisplayName,
            functionName: uniqueFunctionName,
        };
    });

    return {
        generatorVersion: GENERATOR_VERSION,
        contractVersion: GENERATOR_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        spec: {
            title: request.spec.info.title,
            version: request.spec.info.version,
            description: request.spec.info.description,
            baseUrl: request.spec.apiModel?.baseUrls[0] || request.spec.baseUrl,
        },
        server: request.serverConfig,
        runtime: {
            language: request.exportConfig.language,
            framework: request.exportConfig.framework,
            packageManager: request.exportConfig.packageManager,
            transport: request.serverConfig.transport,
            transportStrategy: getTransportStrategy(request.serverConfig.transport),
            // Threaded from the request; false by default and inert until the
            // Node/Python targets implement meta-tool emission (see the design
            // contract on GenerationPlan.runtime.compactMode in types.ts).
            compactMode: request.exportConfig.compactMode ?? false,
        },
        auth,
        mcpServerAuth,
        features: getDefaultFeatures(request.exportConfig),
        verificationMode: request.exportConfig.verificationMode || "fast",
        tools,
        warnings,
    };
}
