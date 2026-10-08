import { z } from "zod";
import { assertGraphBudget, MAX_SELECTED_TOOLS } from "../processing/limits.ts";
import type { GeneratorRequest } from "./types.ts";
import type { ApiModel } from "@/lib/api-model";

// Workload / abuse caps (finding H2/R1). These bound the amount of
// user-controlled data that flows into codegen so a single request cannot
// exhaust memory/CPU. Values are generous for real specs but reject payloads
// that are clearly hostile or degenerate.
const MAX_TOOLS = MAX_SELECTED_TOOLS;
const MAX_TOOL_PARAMETERS = 500;
const MAX_ARRAY_ITEMS = 2000;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 8000;
const MAX_SHORT_STRING_LENGTH = 2000;
const MAX_URL_LENGTH = 4000;
const MAX_SERVER_NAME_LENGTH = 64;

// Server folder / archive name. Constrained to a safe filename charset so it
// cannot be used for Zip Slip (path traversal into the archive) or
// Content-Disposition header injection (finding M1/R7). The regex disallows
// path separators, "..", control characters, quotes and leading dots.
const SAFE_SERVER_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

const shortString = z.string().trim().min(1).max(MAX_SHORT_STRING_LENGTH);
const descriptionString = z.string().max(MAX_DESCRIPTION_LENGTH);

const parameterLocationSchema = z.enum(["path", "query", "header", "cookie", "body"]);

const toolParameterSchema = z.object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    originalName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    type: z.string().trim().min(1).max(MAX_SHORT_STRING_LENGTH),
    required: z.boolean(),
    description: descriptionString.default(""),
    location: parameterLocationSchema.optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    hidden: z.boolean().optional(),
});

// MCP tool annotations (MCP 2025-11-25). Optional behavioral hints; the boolean
// flags are advisory and never weaken any server-side enforcement.
const toolAnnotationsSchema = z.object({
    title: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
});

export const toolSchema = z.object({
    endpointId: shortString,
    enabled: z.boolean().default(true),
    toolName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    description: descriptionString.default(""),
    parameters: z.array(toolParameterSchema).max(MAX_TOOL_PARAMETERS),
    bodySchema: z.record(z.string(), z.unknown()).optional(),
    bodyContentType: shortString.optional(),
    // Optional MCP metadata (MCP 2025-11-25). title is a human-friendly display
    // name; outputSchema is a JSON Schema for structured output, bounded like the
    // other open-ended JSON blobs above.
    title: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    annotations: toolAnnotationsSchema.optional(),
});

export const authSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({
        type: z.literal("apiKey"),
        apiKey: z.object({
            name: shortString,
            in: z.enum(["header", "query", "cookie"]),
        }),
    }),
    z.object({ type: z.literal("bearer") }),
    z.object({ type: z.literal("basic") }),
]);

export const mcpServerAuthSchema = z.object({
    type: z.enum(["none", "bearer"]).default("none"),
    allowedOrigins: z.array(shortString).max(MAX_ARRAY_ITEMS).optional().default([]),
}).default({
    type: "none",
    allowedOrigins: [],
});

export const exportSchema = z.object({
    language: z.enum(["node", "python"]),
    framework: z.enum(["mcp-ts-sdk", "fastmcp"]),
    packageManager: z.enum(["npm", "pnpm", "yarn"]),
    verificationMode: z.enum(["fast", "full"]).optional().default("fast"),
    features: z.object({
        documentation: z.boolean().optional(),
        docker: z.boolean().optional(),
        tests: z.boolean().optional(),
        verification: z.boolean().optional(),
    }).optional(),
    // Compact mode (meta-tools). When true, targets emit three meta-tools
    // (list/get-schema/invoke) instead of one MCP tool per operation. Optional
    // and defaults to false; inert until the Node/Python targets implement
    // emission. See the design contract on GenerationPlan.runtime in types.ts.
    compactMode: z.boolean().optional().default(false),
});

// --- ApiModel structural validation (finding R2) ---------------------------
// The previous z.custom<ApiModel>() was a no-op cast of arbitrary client JSON
// that drives code generation. We now validate the closed structure and known
// enums. Genuinely open-ended fields (JSON Schema blobs, raw source payloads,
// examples) are accepted as opaque JSON, but their shape (object vs array) is
// still enforced where the type declares it.

// JSON Schema `schema` blobs and other Record<string, unknown> fields: these
// are legitimately open-ended, so we only assert they are JSON objects.
const openJsonObject = z.record(z.string(), z.unknown());

const apiExampleSchema = z.object({
    summary: shortString.optional(),
    description: descriptionString.optional(),
    value: z.unknown().optional(),
    externalValue: shortString.optional(),
});

const apiExampleMap = z.record(z.string(), apiExampleSchema);

const apiMediaTypeSchema = z.object({
    mediaType: shortString,
    schema: openJsonObject.optional(),
    example: z.unknown().optional(),
    examples: apiExampleMap.optional(),
    encoding: openJsonObject.optional(),
});

const apiServerVariableSchema = z.object({
    default: z.string().max(MAX_SHORT_STRING_LENGTH),
    description: descriptionString.optional(),
    enum: z.array(z.string().max(MAX_SHORT_STRING_LENGTH)).max(MAX_ARRAY_ITEMS).optional(),
});

const apiServerSchema = z.object({
    url: z.string().max(MAX_URL_LENGTH),
    description: descriptionString.optional(),
    variables: z.record(z.string(), apiServerVariableSchema).optional(),
    resolvedUrl: z.string().max(MAX_URL_LENGTH).optional(),
});

const apiParameterLocationSchema = z.enum(["path", "query", "header", "cookie"]);
const apiHttpMethodSchema = z.enum([
    "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE",
]);
const apiSourceFormatSchema = z.enum(["openapi", "postman"]);

// ApiSecurityRequirement is Record<string, string[]>.
const apiSecurityRequirementSchema = z.record(
    z.string().max(MAX_NAME_LENGTH),
    z.array(z.string().max(MAX_SHORT_STRING_LENGTH)).max(MAX_ARRAY_ITEMS),
);

const apiParameterSchema = z.object({
    name: z.string().max(MAX_NAME_LENGTH),
    in: apiParameterLocationSchema,
    required: z.boolean(),
    schema: openJsonObject.optional(),
    description: descriptionString.optional(),
    deprecated: z.boolean().optional(),
    allowEmptyValue: z.boolean().optional(),
    style: shortString.optional(),
    explode: z.boolean().optional(),
    allowReserved: z.boolean().optional(),
    content: z.array(apiMediaTypeSchema).max(MAX_ARRAY_ITEMS).optional(),
    example: z.unknown().optional(),
    examples: apiExampleMap.optional(),
    source: z.object({
        level: z.enum(["path", "operation"]),
        raw: openJsonObject.optional(),
    }).optional(),
});

const apiRequestBodySchema = z.object({
    description: descriptionString.optional(),
    required: z.boolean(),
    content: z.array(apiMediaTypeSchema).max(MAX_ARRAY_ITEMS),
});

const apiHeaderSchema = z.object({
    description: descriptionString.optional(),
    required: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    schema: openJsonObject.optional(),
    style: shortString.optional(),
    explode: z.boolean().optional(),
    example: z.unknown().optional(),
    examples: apiExampleMap.optional(),
});

const apiResponseSchema = z.object({
    statusCode: z.string().max(MAX_NAME_LENGTH),
    description: descriptionString.optional(),
    headers: z.record(z.string(), apiHeaderSchema).optional(),
    content: z.array(apiMediaTypeSchema).max(MAX_ARRAY_ITEMS).optional(),
    links: openJsonObject.optional(),
});

const apiOperationSchema = z.object({
    id: z.string().max(MAX_NAME_LENGTH),
    method: apiHttpMethodSchema,
    path: z.string().max(MAX_URL_LENGTH),
    operationId: z.string().max(MAX_NAME_LENGTH).optional(),
    summary: shortString.optional(),
    description: descriptionString.optional(),
    tags: z.array(z.string().max(MAX_NAME_LENGTH)).max(MAX_ARRAY_ITEMS).optional(),
    deprecated: z.boolean().optional(),
    parameters: z.array(apiParameterSchema).max(MAX_ARRAY_ITEMS),
    requestBody: apiRequestBodySchema.optional(),
    responses: z.array(apiResponseSchema).max(MAX_ARRAY_ITEMS),
    security: z.array(apiSecurityRequirementSchema).max(MAX_ARRAY_ITEMS).optional(),
    servers: z.array(apiServerSchema).max(MAX_ARRAY_ITEMS).optional(),
    pathServers: z.array(apiServerSchema).max(MAX_ARRAY_ITEMS).optional(),
    source: z.object({
        name: shortString.optional(),
        folderPath: z.array(z.string().max(MAX_NAME_LENGTH)).max(MAX_ARRAY_ITEMS).optional(),
        raw: openJsonObject.optional(),
    }).optional(),
});

export const apiModelSchema: z.ZodType<ApiModel> = z.object({
    source: z.object({
        format: apiSourceFormatSchema,
        version: shortString.optional(),
        name: shortString.optional(),
        schemaUrl: z.string().max(MAX_URL_LENGTH).optional(),
        importedFrom: z.string().max(MAX_URL_LENGTH).optional(),
    }),
    info: z.object({
        title: z.string().max(MAX_SHORT_STRING_LENGTH),
        version: z.string().max(MAX_SHORT_STRING_LENGTH),
        description: descriptionString.optional(),
        termsOfService: z.string().max(MAX_URL_LENGTH).optional(),
        contact: openJsonObject.optional(),
        license: openJsonObject.optional(),
    }),
    servers: z.array(apiServerSchema).max(MAX_ARRAY_ITEMS),
    baseUrls: z.array(z.string().max(MAX_URL_LENGTH)).max(MAX_ARRAY_ITEMS),
    // securitySchemes / SecurityScheme are open-ended (Record<string, unknown>).
    securitySchemes: z.record(z.string().max(MAX_NAME_LENGTH), openJsonObject),
    security: z.array(apiSecurityRequirementSchema).max(MAX_ARRAY_ITEMS),
    operations: z.array(apiOperationSchema).max(MAX_ARRAY_ITEMS * 5),
}) as z.ZodType<ApiModel>;

export const serverConfigSchema = z.object({
    // Constrained charset prevents Zip Slip + header injection (M1/R7).
    name: z.string().trim().min(1).max(MAX_SERVER_NAME_LENGTH).regex(
        SAFE_SERVER_NAME,
        "name may only contain letters, digits, '.', '_' and '-' and must not start with a separator",
    ),
    version: shortString,
    host: shortString,
    port: z.number().int().min(1).max(65535),
    transport: z.enum(["stdio", "sse", "http"]).default("http"),
});

const requestSchema = z.object({
    spec: z.object({
        info: z.object({
            title: z.string().trim().min(1).max(MAX_SHORT_STRING_LENGTH),
            version: z.string().trim().min(1).max(MAX_SHORT_STRING_LENGTH),
            description: descriptionString.optional(),
        }),
        baseUrl: z.string().max(MAX_URL_LENGTH).default(""),
        apiModel: apiModelSchema.optional(),
    }),
    tools: z.array(toolSchema).max(MAX_TOOLS),
    serverConfig: serverConfigSchema,
    authConfig: authSchema,
    mcpServerAuthConfig: mcpServerAuthSchema,
    exportConfig: exportSchema,
});

export function parseGeneratorRequestPayload(input: unknown): GeneratorRequest {
    assertGraphBudget(input);
    return requestSchema.parse(input);
}
