import type {
    ApiMediaType,
    ApiModel,
    ApiOperation,
    ApiParameter,
    ApiRequestBody,
    ApiResponse,
    ApiSecurityRequirement,
    ApiSourceMetadata,
} from "./types";

export interface PostmanCollection {
    info: {
        name: string;
        description?: string;
        schema: string;
        version?: string | { major?: number; minor?: number; patch?: number; identifier?: string };
    };
    item: PostmanItem[];
    variable?: PostmanVariable[];
    auth?: PostmanAuth;
}

export interface PostmanItem {
    name: string;
    description?: string;
    request?: PostmanRequest;
    item?: PostmanItem[];
    response?: PostmanResponse[];
    auth?: PostmanAuth | null;
    disabled?: boolean;
}

export interface PostmanRequest {
    method: string;
    header?: PostmanHeader[];
    body?: PostmanBody;
    url: PostmanUrl | string;
    description?: string;
    auth?: PostmanAuth | null;
}

export interface PostmanUrl {
    raw?: string;
    protocol?: string;
    host?: string[];
    path?: string[];
    query?: PostmanQuery[];
    variable?: PostmanVariable[];
}

interface PostmanHeader {
    key: string;
    value?: string;
    description?: string;
    disabled?: boolean;
}

interface PostmanQuery {
    key: string;
    value?: string;
    description?: string;
    disabled?: boolean;
}

interface PostmanVariable {
    key: string;
    value?: unknown;
    initial?: unknown;
    current?: unknown;
    description?: string;
    disabled?: boolean;
    enabled?: boolean;
}

interface PostmanBody {
    mode: "raw" | "formdata" | "urlencoded" | "file" | "graphql";
    raw?: string;
    formdata?: Array<{ key: string; value?: string; type?: string; description?: string; disabled?: boolean }>;
    urlencoded?: Array<{ key: string; value?: string; description?: string; disabled?: boolean }>;
    file?: { src?: string | string[] };
    graphql?: { query?: string; variables?: string };
    options?: { raw?: { language?: string } };
}

interface PostmanAuth {
    type: string;
    apikey?: { key: string; value: string }[];
    bearer?: { key: string; value: string }[];
    basic?: { key: string; value: string }[];
}

type PostmanVariableSource =
    | Record<string, unknown>
    | PostmanVariable[]
    | { values?: PostmanVariable[]; variable?: PostmanVariable[] };

export interface PostmanBuildOptions {
    variables?: PostmanVariableSource;
    environment?: PostmanVariableSource;
    globals?: PostmanVariableSource;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE"]);

function asString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return undefined;
}

function variableValue(variable: PostmanVariable): string | undefined {
    return asString(variable.current) ?? asString(variable.value) ?? asString(variable.initial);
}

function variablesToRecord(source?: PostmanVariableSource): Record<string, string> {
    if (!source) return {};

    const values = Array.isArray(source)
        ? source
        : Array.isArray(source.values)
            ? source.values
            : Array.isArray(source.variable)
                ? source.variable
                : undefined;

    if (values) {
        return Object.fromEntries(values.flatMap((variable) => {
            if (!variable.key || variable.disabled || variable.enabled === false) return [];
            const value = variableValue(variable);
            return value === undefined ? [] : [[variable.key, value]];
        }));
    }

    return Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
        const normalized = asString(value);
        return normalized === undefined ? [] : [[key, normalized]];
    }));
}

function buildVariableMap(collection: PostmanCollection, options: PostmanBuildOptions): Record<string, string> {
    return {
        ...variablesToRecord(options.globals),
        ...variablesToRecord(collection.variable),
        ...variablesToRecord(options.environment),
        ...variablesToRecord(options.variables),
    };
}

function replaceVariables(value: string | undefined, variables: Record<string, string>): string | undefined {
    if (value === undefined) return undefined;
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key) => variables[key] ?? match);
}

function decodeQueryPart(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    try {
        return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
        return value;
    }
}

interface PostmanResponse {
    name: string;
    status?: string;
    code?: number;
    header?: PostmanHeader[];
    body?: string;
}

function versionToString(version?: PostmanCollection["info"]["version"]): string {
    if (!version) return "1.0.0";
    if (typeof version === "string") return version;

    const parts = [version.major, version.minor, version.patch]
        .filter((part): part is number => typeof part === "number");
    return parts.length > 0 ? parts.join(".") : version.identifier || "1.0.0";
}

function inferSchema(value: unknown): Record<string, unknown> {
    if (Array.isArray(value)) {
        return { type: "array", items: value.length > 0 ? inferSchema(value[0]) : { type: "string" } };
    }

    if (typeof value === "object" && value !== null) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, nested] of Object.entries(value)) {
            properties[key] = inferSchema(nested);
            required.push(key);
        }
        return { type: "object", properties, required };
    }

    if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number", example: value };
    if (typeof value === "boolean") return { type: "boolean", example: value };
    return { type: "string", example: value };
}

function extractBaseUrl(collection: PostmanCollection, variables: Record<string, string>): string {
    const baseUrl = variables.baseUrl || variables.base_url || variables.host;
    if (baseUrl) return baseUrl;

    const firstRequest = findFirstRequest(collection.item);
    if (!firstRequest?.request?.url) return "";

    const url = firstRequest.request.url;
    if (typeof url === "string") {
        const resolved = replaceVariables(url, variables) || url;
        try {
            const parsed = new URL(resolved);
            return `${parsed.protocol}//${parsed.host}`;
        } catch {
            return resolved.split("/").slice(0, 3).join("/");
        }
    }

    if (url.raw) {
        const resolved = replaceVariables(url.raw, variables) || url.raw;
        try {
            const parsed = new URL(resolved);
            return `${parsed.protocol}//${parsed.host}`;
        } catch {
            // Continue to structured host parsing.
        }
    }

    if (url.host) {
        const protocol = replaceVariables(url.protocol, variables) || "https";
        const host = url.host.map((part) => replaceVariables(part, variables) || part).join(".");
        return `${protocol}://${host}`;
    }

    return "";
}

function findFirstRequest(items: PostmanItem[]): PostmanItem | null {
    for (const item of items) {
        if (item.disabled) continue;
        if (item.request) return item;
        if (item.item) {
            const found = findFirstRequest(item.item);
            if (found) return found;
        }
    }
    return null;
}

function normalizePath(path: string): { path: string; params: ApiParameter[] } {
    const params: ApiParameter[] = [];
    let normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const matches = normalizedPath.match(/[:{}]([^/}]+)[}]?/g) || [];

    for (const match of matches) {
        const name = match.replace(/[:{}/]/g, "");
        if (!params.some((param) => param.name === name)) {
            params.push({
                name,
                in: "path",
                required: true,
                schema: { type: "string" },
                style: "simple",
                explode: false,
                source: { level: "operation" },
            });
        }
        normalizedPath = normalizedPath.replace(match, `{${name}}`);
    }

    return { path: normalizedPath, params };
}

function queryParameter(key: string, value?: string, description?: string): ApiParameter {
    return {
        name: key,
        in: "query",
        required: false,
        description,
        schema: { type: "string", example: value },
        style: "form",
        explode: true,
        source: { level: "operation" },
    };
}

function addRawQueryParameters(rawUrl: string, queryParameters: Map<string, ApiParameter>) {
    const queryPart = rawUrl.split("?")[1]?.split("#")[0];
    if (!queryPart) return;

    for (const part of queryPart.split("&")) {
        if (!part) continue;
        const [rawKey, ...rawValueParts] = part.split("=");
        const key = decodeQueryPart(rawKey);
        if (!key) continue;
        queryParameters.set(key, queryParameter(key, decodeQueryPart(rawValueParts.join("="))));
    }
}

function requestOrigin(url: PostmanUrl | string, variables: Record<string, string>): string | undefined {
    const urlVariables = typeof url === "string" ? variables : { ...variables, ...variablesToRecord(url.variable) };
    const raw = typeof url === "string" ? url : url.raw || (url.host?.length ? `${url.protocol || "https"}://${url.host.join(".")}` : "");
    try {
        const parsed = new URL(replaceVariables(raw, urlVariables) || raw);
        return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : undefined;
    } catch {
        return undefined;
    }
}

function parseUrl(url: PostmanUrl | string, variables: Record<string, string>): { path: string; parameters: ApiParameter[] } {
    const queryParameters = new Map<string, ApiParameter>();
    let path = "/";

    if (typeof url === "string") {
        const resolvedUrl = replaceVariables(url, variables) || url;
        try {
            const parsed = new URL(resolvedUrl);
            path = parsed.pathname || "/";
            parsed.searchParams.forEach((value, key) => {
                queryParameters.set(key, queryParameter(key, value));
            });
        } catch {
            const [pathPart, queryPart] = resolvedUrl.split("?");
            path = pathPart || "/";
            if (queryPart) {
                for (const part of queryPart.split("&")) {
                    const [rawKey, ...rawValueParts] = part.split("=");
                    const key = decodeQueryPart(rawKey);
                    if (!key) continue;
                    queryParameters.set(key, queryParameter(key, decodeQueryPart(rawValueParts.join("="))));
                }
            }
        }
    } else {
        const urlVariables = { ...variables, ...variablesToRecord(url.variable) };
        const raw = replaceVariables(url.raw, urlVariables);
        if (raw) {
            addRawQueryParameters(raw, queryParameters);
        }

        if (url.path?.length) {
            path = `/${url.path.map((part) => replaceVariables(part, urlVariables) || part).join("/")}`;
        } else if (raw) {
            try {
                path = new URL(raw).pathname || "/";
            } catch {
                path = raw.split("?")[0] || "/";
            }
        }

        for (const query of url.query || []) {
            if (query.disabled) continue;
            const key = replaceVariables(query.key, urlVariables) || query.key;
            const value = replaceVariables(query.value, urlVariables);
            queryParameters.set(key, queryParameter(key, value, query.description));
        }
    }

    path = replaceVariables(path, variables) || path;
    const normalized = normalizePath(path);
    return { path: normalized.path, parameters: [...normalized.params, ...queryParameters.values()] };
}

function mediaTypeFromBody(body: PostmanBody): ApiMediaType {
    if (body.mode === "raw") {
        const language = body.options?.raw?.language?.toLowerCase();
        const raw = body.raw || "";
        const looksJson = ["json", "javascript"].includes(language || "") || /^[\s]*[{[]/.test(raw);
        if (looksJson && raw) {
            try {
                const parsed = JSON.parse(raw);
                return { mediaType: "application/json", schema: inferSchema(parsed), example: parsed };
            } catch {
                return { mediaType: "application/json", schema: { type: "string" }, example: raw };
            }
        }

        const mediaType = language === "html"
            ? "text/html"
            : language === "xml"
                ? "application/xml"
                : "text/plain";
        return { mediaType, schema: { type: "string" }, example: raw };
    }

    if (body.mode === "urlencoded") {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const field of body.urlencoded || []) {
            if (field.disabled) continue;
            properties[field.key] = { type: "string", description: field.description, example: field.value };
            required.push(field.key);
        }
        return { mediaType: "application/x-www-form-urlencoded", schema: { type: "object", properties, required } };
    }

    if (body.mode === "formdata") {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const field of body.formdata || []) {
            if (field.disabled) continue;
            properties[field.key] = {
                type: "string",
                format: field.type === "file" ? "binary" : undefined,
                description: field.description,
                example: field.type === "file" ? undefined : field.value,
            };
            required.push(field.key);
        }
        return { mediaType: "multipart/form-data", schema: { type: "object", properties, required } };
    }

    if (body.mode === "file") {
        return { mediaType: "application/octet-stream", schema: { type: "string", format: "binary" }, example: body.file?.src };
    }

    return {
        mediaType: "application/json",
        schema: {
            type: "object",
            properties: {
                query: { type: "string", example: body.graphql?.query },
                variables: { type: "object" },
            },
            required: ["query"],
        },
        example: {
            query: body.graphql?.query,
            variables: (() => {
                if (!body.graphql?.variables) return undefined;
                try {
                    return JSON.parse(body.graphql.variables);
                } catch {
                    return body.graphql.variables;
                }
            })(),
        },
    };
}

function normalizeRequestBody(body?: PostmanBody): ApiRequestBody | undefined {
    if (!body) return undefined;
    return {
        required: true,
        content: [mediaTypeFromBody(body)],
    };
}

function normalizeResponses(responses?: PostmanResponse[]): ApiResponse[] {
    return (responses || []).map((response) => ({
        statusCode: String(response.code || "default"),
        description: response.status || response.name,
        headers: response.header
            ? Object.fromEntries(response.header.filter((header) => !header.disabled).map((header) => [
                header.key,
                {
                    description: header.description,
                    schema: { type: "string", example: header.value },
                },
            ]))
            : undefined,
        content: response.body
            ? [{ mediaType: "application/json", schema: { type: "string" }, example: response.body }]
            : undefined,
    }));
}

function securityFromAuth(auth?: PostmanAuth | null): {
    schemes: ApiModel["securitySchemes"];
    requirements: ApiSecurityRequirement[];
} {
    if (!auth) return { schemes: {}, requirements: [] };
    if (auth.type === "noauth") return { schemes: {}, requirements: [] };

    if (auth.type === "apikey") {
        const location = auth.apikey?.find((item) => item.key === "in")?.value || "header";
        const name = auth.apikey?.find((item) => item.key === "key")?.value || "X-API-Key";
        return {
            schemes: {
                apiKey: {
                    type: "apiKey",
                    in: location,
                    name,
                },
            },
            requirements: [{ apiKey: [] }],
        };
    }

    if (auth.type === "bearer") {
        return { schemes: { bearer: { type: "http", scheme: "bearer" } }, requirements: [{ bearer: [] }] };
    }

    if (auth.type === "basic") {
        return { schemes: { basic: { type: "http", scheme: "basic" } }, requirements: [{ basic: [] }] };
    }

    return { schemes: {}, requirements: [] };
}

function mergeSecuritySchemes(
    target: ApiModel["securitySchemes"],
    source: ApiModel["securitySchemes"]
) {
    for (const [key, value] of Object.entries(source)) {
        target[key] = value;
    }
}

function shouldExcludeGeneratedAuthHeader(header: PostmanHeader, auth?: PostmanAuth | null): boolean {
    if (!auth || auth.type === "noauth") return false;

    const name = header.key.toLowerCase();
    if ((auth.type === "bearer" || auth.type === "basic") && name === "authorization") return true;

    if (auth.type === "apikey") {
        const location = auth.apikey?.find((item) => item.key === "in")?.value || "header";
        const key = auth.apikey?.find((item) => item.key === "key")?.value || "X-API-Key";
        return location === "header" && name === key.toLowerCase();
    }

    return false;
}

function operationId(method: string, path: string, name: string): string {
    const cleanName = name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join("");

    if (cleanName) return cleanName;

    return `${method.toLowerCase()}${path.split("/").filter(Boolean).map((part) =>
        part.startsWith("{") ? `By${part.slice(1, -1)}` : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    ).join("")}`;
}

export function buildPostmanApiModel(
    collection: PostmanCollection,
    source: Partial<ApiSourceMetadata> = {},
    options: PostmanBuildOptions = {}
): ApiModel {
    const variables = buildVariableMap(collection, options);
    const baseUrl = extractBaseUrl(collection, variables);
    const collectionAuth = securityFromAuth(collection.auth);
    const securitySchemes: ApiModel["securitySchemes"] = { ...collectionAuth.schemes };
    const operations: ApiOperation[] = [];
    let id = 0;

    function visit(item: PostmanItem, folderPath: string[] = [], inheritedAuth: PostmanAuth | null | undefined = collection.auth) {
        if (item.disabled) return;

        if (item.item) {
            const folderAuth = item.auth !== undefined ? item.auth : inheritedAuth;
            for (const child of item.item) visit(child, [...folderPath, item.name], folderAuth);
            return;
        }

        if (!item.request) return;

        const method = item.request.method.toUpperCase();
        if (!HTTP_METHODS.has(method)) return;

        const effectiveAuth = item.request.auth !== undefined ? item.request.auth : inheritedAuth;
        const operationAuth = securityFromAuth(effectiveAuth);
        mergeSecuritySchemes(securitySchemes, operationAuth.schemes);

        const url = parseUrl(item.request.url, variables);
        const origin = requestOrigin(item.request.url, variables);
        const headerParameters: ApiParameter[] = (item.request.header || [])
            .filter((header) => !header.disabled && !shouldExcludeGeneratedAuthHeader(header, effectiveAuth))
            .map((header) => ({
                name: replaceVariables(header.key, variables) || header.key,
                in: "header",
                required: false,
                description: header.description,
                schema: { type: "string", example: replaceVariables(header.value, variables) },
                style: "simple",
                explode: false,
                source: { level: "operation" },
            }));

        operations.push({
            id: `${method}::${url.path}::${id++}`,
            method: method as ApiOperation["method"],
            path: url.path,
            servers: origin ? [{ url: origin }] : undefined,
            operationId: operationId(method, url.path, item.name),
            summary: item.name,
            description: item.description || item.request.description,
            tags: folderPath.length > 0 ? [folderPath[folderPath.length - 1]] : undefined,
            parameters: [...url.parameters, ...headerParameters],
            requestBody: normalizeRequestBody(item.request.body),
            responses: normalizeResponses(item.response),
            security: effectiveAuth === undefined ? undefined : operationAuth.requirements,
            source: {
                name: item.name,
                folderPath,
                raw: { disabled: item.disabled, authInherited: item.request.auth === undefined },
            },
        });
    }

    for (const item of collection.item) visit(item);

    return {
        source: {
            format: "postman",
            version: versionToString(collection.info.version),
            name: collection.info.name,
            schemaUrl: collection.info.schema,
            ...source,
        },
        info: {
            title: collection.info.name,
            version: versionToString(collection.info.version),
            description: collection.info.description,
        },
        servers: baseUrl
            ? [{
                url: baseUrl,
                variables: Object.fromEntries(Object.entries(variables).map(([key, value]) => [
                    key,
                    { default: value, description: collection.variable?.find((variable) => variable.key === key)?.description },
                ])),
            }]
            : [],
        baseUrls: baseUrl ? [baseUrl] : [],
        securitySchemes,
        security: collectionAuth.requirements,
        operations,
    };
}
