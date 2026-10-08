import type {
    ApiMediaType,
    ApiModel,
    ApiOperation,
    ApiParameter,
    ApiResponse,
    ApiHeader,
    ApiSecurityRequirement,
    ApiServer,
    ApiSourceMetadata,
} from "./types";

export type OpenAPISpec = Record<string, unknown> & {
    openapi?: string;
    swagger?: string;
    info?: Record<string, unknown>;
    servers?: unknown[];
    host?: string;
    basePath?: string;
    schemes?: string[];
    consumes?: string[];
    produces?: string[];
    paths?: Record<string, Record<string, unknown>>;
    components?: { securitySchemes?: Record<string, Record<string, unknown>> };
    securityDefinitions?: Record<string, Record<string, unknown>>;
    security?: ApiSecurityRequirement[];
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as T;
}

function resolveServerUrl(server: ApiServer): string {
    if (!server.variables) return server.url;

    return Object.entries(server.variables).reduce((url, [name, variable]) =>
        url.replace(new RegExp(`\\{${name}\\}`, "g"), variable.default),
        server.url
    );
}

function normalizeServers(api: OpenAPISpec): ApiServer[] {
    if (Array.isArray(api.servers) && api.servers.length > 0) {
        return api.servers.flatMap((server) => {
            const record = asRecord(server);
            const url = asString(record?.url);
            if (!record || !url) return [];

            const variables = asRecord(record.variables);
            const normalizedServer: ApiServer = {
                url,
                description: asString(record.description),
                variables: variables
                    ? Object.fromEntries(Object.entries(variables).flatMap(([key, variable]) => {
                        const variableRecord = asRecord(variable);
                        const defaultValue = asString(variableRecord?.default);
                        if (!variableRecord || defaultValue === undefined) return [];

                        return [[key, {
                            default: defaultValue,
                            description: asString(variableRecord.description),
                            enum: Array.isArray(variableRecord.enum)
                                ? variableRecord.enum.filter((item): item is string => typeof item === "string")
                                : undefined,
                        }]];
                    }))
                    : undefined,
            };

            return [{
                ...normalizedServer,
                resolvedUrl: resolveServerUrl(normalizedServer),
            }];
        });
    }

    if (api.host) {
        const scheme = api.schemes?.[0] || "https";
        const url = `${scheme}://${api.host}${api.basePath || ""}`;
        return [{
            url,
            resolvedUrl: url,
        }];
    }

    return [];
}

function normalizeMediaTypes(content: unknown): ApiMediaType[] {
    const contentRecord = asRecord(content);
    if (!contentRecord) return [];

    return Object.entries(contentRecord).map(([mediaType, media]) => {
        const mediaRecord = asRecord(media) || {};
        return {
            mediaType,
            schema: asRecord(mediaRecord.schema),
            example: mediaRecord.example,
            examples: asRecord(mediaRecord.examples) as ApiMediaType["examples"],
            encoding: asRecord(mediaRecord.encoding),
        };
    });
}

function schemaFromSwaggerParameter(parameter: Record<string, unknown>): Record<string, unknown> | undefined {
    const type = parameter.type === "file" ? "string" : asString(parameter.type);
    if (!type) return undefined;

    return removeUndefined({
        type,
        format: parameter.type === "file" ? "binary" : parameter.format,
        items: asRecord(parameter.items),
        collectionFormat: parameter.collectionFormat,
        default: parameter.default,
        enum: parameter.enum,
        example: parameter.example,
        minimum: parameter.minimum,
        maximum: parameter.maximum,
        exclusiveMinimum: parameter.exclusiveMinimum,
        exclusiveMaximum: parameter.exclusiveMaximum,
        minLength: parameter.minLength,
        maxLength: parameter.maxLength,
        pattern: parameter.pattern,
        minItems: parameter.minItems,
        maxItems: parameter.maxItems,
        uniqueItems: parameter.uniqueItems,
        multipleOf: parameter.multipleOf,
    });
}

function normalizeParameter(value: unknown, level: "path" | "operation"): ApiParameter | undefined {
    const parameter = asRecord(value);
    const name = asString(parameter?.name);
    const location = parameter?.in;

    if (!parameter || !name || !["path", "query", "header", "cookie"].includes(String(location))) {
        return undefined;
    }

    const schema = asRecord(parameter.schema) || schemaFromSwaggerParameter(parameter);

    const content = normalizeMediaTypes(parameter.content);

    return {
        name,
        in: location as ApiParameter["in"],
        required: location === "path" ? true : Boolean(parameter.required),
        schema,
        description: asString(parameter.description),
        deprecated: asBoolean(parameter.deprecated),
        allowEmptyValue: asBoolean(parameter.allowEmptyValue),
        style: asString(parameter.style),
        explode: asBoolean(parameter.explode),
        allowReserved: asBoolean(parameter.allowReserved),
        content: content.length > 0 ? content : undefined,
        example: parameter.example,
        examples: asRecord(parameter.examples) as ApiParameter["examples"],
        source: { level, raw: parameter },
    };
}

function mergeParameters(pathParameters: ApiParameter[], operationParameters: ApiParameter[]): ApiParameter[] {
    const byLocationAndName = new Map<string, number>();
    const merged: ApiParameter[] = [];

    for (const parameter of pathParameters) {
        byLocationAndName.set(`${parameter.in}:${parameter.name}`, merged.length);
        merged.push(parameter);
    }

    for (const parameter of operationParameters) {
        const key = `${parameter.in}:${parameter.name}`;
        const existingIndex = byLocationAndName.get(key);

        if (existingIndex === undefined) {
            byLocationAndName.set(key, merged.length);
            merged.push(parameter);
        } else {
            merged[existingIndex] = parameter;
        }
    }

    return merged;
}

function contentTypesFor(operation: Record<string, unknown>, api: OpenAPISpec, fallback: string[]): string[] {
    return asStringArray(operation.consumes) || asStringArray(api.consumes) || fallback;
}

function normalizeSwaggerBodyParameter(
    operation: Record<string, unknown>,
    api: OpenAPISpec
): ApiOperation["requestBody"] {
    const parameters = Array.isArray(operation.parameters)
        ? operation.parameters.map((parameter) => asRecord(parameter)).filter(Boolean) as Record<string, unknown>[]
        : [];
    const bodyParameter = parameters.find((parameter) => parameter.in === "body");

    if (bodyParameter) {
        return {
            description: asString(bodyParameter.description),
            required: Boolean(bodyParameter.required),
            content: contentTypesFor(operation, api, ["application/json"]).map((mediaType) => ({
                mediaType,
                schema: asRecord(bodyParameter.schema),
                example: bodyParameter.example,
                examples: asRecord(bodyParameter.examples) as ApiMediaType["examples"],
            })),
        };
    }

    const formParameters = parameters.filter((parameter) => parameter.in === "formData");
    if (formParameters.length === 0) return undefined;

    const required = formParameters
        .filter((parameter) => Boolean(parameter.required))
        .map((parameter) => asString(parameter.name))
        .filter((name): name is string => Boolean(name));
    const properties = Object.fromEntries(formParameters.flatMap((parameter) => {
        const name = asString(parameter.name);
        if (!name) return [];

        return [[name, removeUndefined({
            ...(schemaFromSwaggerParameter(parameter) || { type: "string" }),
            description: parameter.description,
        })]];
    }));
    const schema = removeUndefined({
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
    });

    return {
        required: required.length > 0,
        content: contentTypesFor(operation, api, ["application/x-www-form-urlencoded"]).map((mediaType) => ({
            mediaType,
            schema,
        })),
    };
}

function normalizeRequestBody(operation: Record<string, unknown>, api: OpenAPISpec): ApiOperation["requestBody"] {
    const requestBody = asRecord(operation.requestBody);
    if (requestBody) {
        return {
            description: asString(requestBody.description),
            required: Boolean(requestBody.required),
            content: normalizeMediaTypes(requestBody.content),
        };
    }

    return normalizeSwaggerBodyParameter(operation, api);
}

function normalizeResponses(responses: unknown, operation: Record<string, unknown>, api: OpenAPISpec): ApiResponse[] {
    const responseRecords = asRecord(responses);
    if (!responseRecords) return [];

    return Object.entries(responseRecords).map(([statusCode, response]) => {
        const responseRecord = asRecord(response) || {};
        const responseContent = normalizeMediaTypes(responseRecord.content);
        const swaggerSchema = asRecord(responseRecord.schema);

        return {
            statusCode,
            description: asString(responseRecord.description),
            headers: normalizeHeaders(responseRecord.headers),
            content: responseContent.length > 0
                ? responseContent
                : swaggerSchema
                    ? (asStringArray(operation.produces) || asStringArray(api.produces) || ["application/json"])
                        .map((mediaType) => ({ mediaType, schema: swaggerSchema }))
                    : [],
            links: asRecord(responseRecord.links),
        };
    });
}

function normalizeHeaders(headers: unknown): Record<string, ApiHeader> | undefined {
    const headerRecords = asRecord(headers);
    if (!headerRecords) return undefined;

    return Object.fromEntries(Object.entries(headerRecords).flatMap(([name, header]) => {
        const headerRecord = asRecord(header);
        if (!headerRecord) return [];

        return [[name, {
            description: asString(headerRecord.description),
            required: asBoolean(headerRecord.required),
            deprecated: asBoolean(headerRecord.deprecated),
            schema: asRecord(headerRecord.schema),
            style: asString(headerRecord.style),
            explode: asBoolean(headerRecord.explode),
            example: headerRecord.example,
            examples: asRecord(headerRecord.examples) as ApiHeader["examples"],
        }]];
    }));
}

function operationIdFor(method: string, path: string, operation: Record<string, unknown>): string {
    return asString(operation.operationId) || `${method.toUpperCase()}-${path}`;
}

function normalizeSecurityRequirements(value: unknown): ApiSecurityRequirement[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((requirement) => {
        const record = asRecord(requirement);
        if (!record) return [];

        return [Object.fromEntries(Object.entries(record).map(([name, scopes]) => [
            name,
            asStringArray(scopes) || [],
        ]))];
    });
}

function normalizeSecuritySchemes(api: OpenAPISpec): Record<string, Record<string, unknown>> {
    if (api.components?.securitySchemes) return api.components.securitySchemes;
    if (!api.securityDefinitions) return {};

    return Object.fromEntries(Object.entries(api.securityDefinitions).map(([name, scheme]) => {
        if (scheme.type === "basic") {
            return [name, { ...scheme, type: "http", scheme: "basic", sourceType: "basic" }];
        }

        return [name, scheme];
    }));
}

export function buildOpenAPIModel(api: OpenAPISpec, source: Partial<ApiSourceMetadata> = {}): ApiModel {
    const servers = normalizeServers(api);
    const globalSecurity = normalizeSecurityRequirements(api.security);
    const operations: ApiOperation[] = [];

    for (const [path, pathItemValue] of Object.entries(api.paths || {})) {
        const pathItem = asRecord(pathItemValue) || {};
        const pathServers = normalizeServers(pathItem as OpenAPISpec);
        const pathParameters = Array.isArray(pathItem.parameters)
            ? pathItem.parameters
                .map((parameter) => normalizeParameter(parameter, "path"))
                .filter((parameter): parameter is ApiParameter => Boolean(parameter))
            : [];

        for (const [method, operationValue] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method)) continue;

            const operation = asRecord(operationValue) || {};
            const operationParameters = Array.isArray(operation.parameters)
                ? operation.parameters
                    .map((parameter) => normalizeParameter(parameter, "operation"))
                    .filter((parameter): parameter is ApiParameter => Boolean(parameter))
                : [];

            operations.push({
                id: `${method.toUpperCase()}-${path}`,
                method: method.toUpperCase() as ApiOperation["method"],
                path,
                operationId: asString(operation.operationId),
                summary: asString(operation.summary),
                description: asString(operation.description),
                tags: Array.isArray(operation.tags)
                    ? operation.tags.filter((tag): tag is string => typeof tag === "string")
                    : undefined,
                deprecated: asBoolean(operation.deprecated),
                parameters: mergeParameters(pathParameters, operationParameters),
                requestBody: normalizeRequestBody(operation, api),
                responses: normalizeResponses(operation.responses, operation, api),
                security: operation.security === undefined
                    ? undefined
                    : normalizeSecurityRequirements(operation.security),
                servers: normalizeServers(operation as OpenAPISpec),
                pathServers,
            });
        }
    }

    const version = api.openapi || api.swagger;
    const info = api.info || {};

    return {
        source: {
            format: "openapi",
            version,
            ...source,
        },
        info: {
            title: asString(info.title) || "Untitled API",
            version: asString(info.version) || "1.0.0",
            description: asString(info.description),
            termsOfService: asString(info.termsOfService),
            contact: asRecord(info.contact),
            license: asRecord(info.license),
        },
        servers,
        baseUrls: servers.map((server) => server.resolvedUrl || server.url),
        securitySchemes: normalizeSecuritySchemes(api),
        security: globalSecurity,
        operations: operations.map((operation) => ({
            ...operation,
            operationId: operation.operationId || operationIdFor(operation.method, operation.path, operation.source?.raw || {}),
        })),
    };
}
