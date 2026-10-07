import type { ApiModel } from "@/lib/api-model";

export const GENERATOR_VERSION = "2.2.0";
export const GENERATOR_CONTRACT_VERSION = 2;

export type Transport = "stdio" | "sse" | "http";
export type TransportStrategy = "stdio" | "sse" | "streamableHttp";
export type ExportLanguage = "node" | "python";
export type ExportFramework = "mcp-ts-sdk" | "fastmcp";
export type PackageManager = "npm" | "pnpm" | "yarn";
export type VerificationMode = "fast" | "full";
export type ParamLocation = "path" | "query" | "header" | "cookie" | "body";
export type AuthStrategy = "none" | "apiKeyHeader" | "apiKeyQuery" | "apiKeyCookie" | "bearer" | "basic";
export type ToolAuthSource = "operation" | "global" | "none" | "unsupported";
export type ToolManualReviewSeverity = "warning" | "error";
export type RequestBodyContentKind =
    | "flattenedObject"
    | "rawJsonObject"
    | "rawArray"
    | "formUrlencoded"
    | "multipart"
    | "text"
    | "binary";

export interface GeneratorRequest {
    spec: {
        info: { title: string; version: string; description?: string };
        baseUrl: string;
        apiModel?: ApiModel;
    };
    tools: GeneratorToolConfig[];
    serverConfig: GeneratorServerConfig;
    authConfig: GeneratorAuthConfig;
    mcpServerAuthConfig?: GeneratorMcpServerAuthConfig;
    exportConfig: GeneratorExportConfig;
}

export interface GeneratorToolConfig {
    endpointId: string;
    enabled: boolean;
    toolName: string;
    description: string;
    parameters: GeneratorToolParameter[];
    bodySchema?: Record<string, unknown>;
    bodyContentType?: string;
    // Optional MCP metadata (MCP 2025-11-25) that the API route may pass through.
    title?: string;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
}

export interface GeneratorToolParameter {
    name: string;
    originalName: string;
    type: string;
    required: boolean;
    description: string;
    location?: ParamLocation;
    schema?: Record<string, unknown>;
    hidden?: boolean;
}

export interface GeneratorServerConfig {
    name: string;
    version: string;
    host: string;
    port: number;
    transport: Transport;
}

export interface GeneratorAuthConfig {
    type: "none" | "apiKey" | "bearer" | "basic";
    apiKey?: { name: string; in: "header" | "query" | "cookie" };
}

export interface GeneratorMcpServerAuthConfig {
    type: "none" | "bearer";
    allowedOrigins?: string[];
}

export interface GenerationFeatureFlags {
    documentation: boolean;
    docker: boolean;
    tests: boolean;
    verification: boolean;
}

export interface GeneratorExportConfig {
    language: ExportLanguage;
    framework: ExportFramework;
    packageManager: PackageManager;
    verificationMode?: VerificationMode;
    features?: Partial<GenerationFeatureFlags>;
    // Compact mode (meta-tools). Optional; defaults to false. See the design
    // contract on GenerationPlan.runtime.compactMode below.
    compactMode?: boolean;
}

export interface GenerationPlan {
    generatorVersion: string;
    contractVersion: number;
    generatedAt: string;
    spec: {
        title: string;
        version: string;
        description?: string;
        baseUrl: string;
    };
    server: GeneratorServerConfig;
    runtime: {
        language: ExportLanguage;
        framework: ExportFramework;
        packageManager: PackageManager;
        transport: Transport;
        transportStrategy: TransportStrategy;
        // ---------------------------------------------------------------------
        // COMPACT MODE (meta-tools) — DESIGN CONTRACT for the Node/Python targets
        // ---------------------------------------------------------------------
        // When `compactMode` is false (the default), targets emit exactly what
        // they emit today: one MCP tool per entry in `plan.tools`. Output MUST
        // stay byte-identical to the non-compact behavior — this flag is inert
        // until a target opts in, and targets that ignore it stay correct.
        //
        // When `compactMode` is true, a target MUST NOT register one tool per
        // operation. Instead it registers exactly THREE meta-tools, built from
        // the SAME `plan.tools` list (which is always fully populated — never
        // trimmed in compact mode — so the target can construct its registry):
        //
        //   1. `list_api_endpoints`
        //      Browse/search the operation catalog. Input (all optional):
        //        { search?: string, tag?: string, method?: HTTP method,
        //          limit?: integer (1..100, default 50), cursor?: string }
        //      Output: lightweight records only, never schemas:
        //        { endpoints: Array<{ id, method, path, summary, tags }>,
        //          next_cursor?, total_estimate }
        //      (`id` is the plan tool id / operationId.)
        //
        //   2. `get_api_endpoint_schema`
        //      Fetch the full contract for one operation on demand. Input:
        //        { endpointId: string }  (required)
        //      Output: { id, method, path, summary, description, parameters[],
        //                requestBody?, outputSchema?, auth[] }.
        //
        //   3. `invoke_api_endpoint`
        //      Actually call one operation. Input:
        //        { endpointId: string (required),
        //          parameters?: { path?, query?, header?, body? } }
        //      Output envelope: { ok, status, endpointId, data?, error? };
        //      on failure `ok:false` with structured
        //      `error: { type, message, details? }`.
        //
        // SAFE-DISPATCH RULE (security-critical, invoke_api_endpoint):
        //   Build an immutable registry from `plan.tools`, keyed by tool id.
        //   a) Refuse unknown ids — look up in the closed registry; if absent
        //      return error.type = "unknown_operation" and make NO HTTP call.
        //   b) Validate the supplied arguments against that operation's schema
        //      (parameters + requestBody) BEFORE any network I/O; reject
        //      missing-required / type-mismatch / unknown params.
        //   c) Build the request from the operation's STORED method + path
        //      template (interpolate validated, encoded path params), never from
        //      a model-supplied URL/string. Never eval or string-build calls.
        //   d) Apply auth server-side from config/env; the model never supplies
        //      secrets. Return a bounded envelope.
        // See "Meta-tools / compact mode design" in the research doc.
        compactMode: boolean;
    };
    auth: NormalizedAuth;
    mcpServerAuth: NormalizedMcpServerAuth;
    features: GenerationFeatureFlags;
    verificationMode: VerificationMode;
    tools: GenerationTool[];
    warnings: string[];
}

export interface ToolPlan {
    id: string;
    operationId?: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "TRACE";
    path: string;
    baseUrl?: string;
    toolName: string;
    title?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
    description: string;
    authStrategy: ToolAuthPlan;
    requestBodyStrategy: ToolRequestBodyPlan;
    serializationStrategy: ToolSerializationPlan;
    parameters: ToolPlanParameter[];
    warnings: string[];
    manualReview: ToolManualReviewFlag[];
}

// MCP tool annotations (MCP 2025-11-25). These are behavioral hints derived from
// HTTP method semantics; they are advisory and MUST NOT be relied on for security.
// All fields are optional so that targets which do not yet emit annotations still
// compile and existing generated output stays unchanged.
export interface ToolAnnotations {
    // Human-friendly display name for the tool (e.g. the operation summary).
    title?: string;
    // The tool does not modify its environment. True for GET and HEAD.
    readOnlyHint?: boolean;
    // The tool may perform destructive updates. True for DELETE, PUT and PATCH.
    // Only meaningful when readOnlyHint is false.
    destructiveHint?: boolean;
    // Repeated calls with the same arguments have no additional effect beyond the
    // first. True for GET, HEAD, PUT and DELETE; false for POST and PATCH.
    idempotentHint?: boolean;
    // The tool interacts with an "open world" of external entities. Always true
    // here because generated tools call external HTTP APIs.
    openWorldHint?: boolean;
}

export interface ToolAuthPlan {
    strategy: AuthStrategy;
    source: ToolAuthSource;
    schemeName?: string;
    apiKeyName?: string;
    apiKeyLocation?: "header" | "query" | "cookie";
    requirement?: Record<string, string[]>;
    requirements?: ToolAuthRequirementPlan[];
}

export interface ToolAuthRequirementPlan {
    requirement: Record<string, string[]>;
    schemes: ToolAuthSchemePlan[];
}

export interface ToolAuthSchemePlan {
    strategy: Exclude<AuthStrategy, "none">;
    schemeName: string;
    apiKeyName?: string;
    apiKeyLocation?: "header" | "query" | "cookie";
}

export interface ToolRequestBodyPlan {
    required: boolean;
    contentType?: string;
    contentKind?: RequestBodyContentKind;
    schema?: Record<string, unknown>;
}

export interface ToolSerializationPlan {
    path: ToolSerializedParameter[];
    query: ToolSerializedParameter[];
    header: ToolSerializedParameter[];
    cookie: ToolSerializedParameter[];
    requestBody?: {
        contentType: string;
        contentKind: RequestBodyContentKind;
        parameterNames: string[];
    };
}

export interface ToolSerializedParameter {
    argName: string;
    sourceName: string;
    required: boolean;
    style?: string;
    explode?: boolean;
}

export interface ToolPlanParameter {
    argName: string;
    sourceName: string;
    // Coarse JSON-Schema type ("string" | "integer" | "number" | "boolean" |
    // "array" | "object"), derived once by the planner from `schema`. This is the
    // single source of truth for the parameter type: it flows through unchanged
    // onto GenerationParam.type and is consumed by the targets (python arg hints,
    // node's zod fallback when `schema` is absent). Targets never re-derive it.
    type: string;
    location: ParamLocation;
    required: boolean;
    description: string;
    schema?: Record<string, unknown>;
    style?: string;
    explode?: boolean;
}

export interface ToolManualReviewFlag {
    code: string;
    severity: ToolManualReviewSeverity;
    message: string;
}

export interface NormalizedAuth {
    strategy: AuthStrategy;
    type: GeneratorAuthConfig["type"];
    apiKeyName?: string;
    apiKeyLocation?: "header" | "query" | "cookie";
}

export interface NormalizedMcpServerAuth {
    type: GeneratorMcpServerAuthConfig["type"];
    tokenEnvVar: "MCP_AUTH_TOKEN";
    allowedOriginsEnvVar: "MCP_ALLOWED_ORIGINS";
    allowedOrigins: string[];
}

export interface GenerationTool {
    id: string;
    displayName: string;
    functionName: string;
    description: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    path: string;
    baseUrl?: string;
    params: GenerationParam[];
    authStrategy: ToolAuthPlan;
    requestBody?: GenerationRequestBody;
    // Optional MCP metadata threaded from the tool plan. Targets that do not yet
    // emit these leave generated output unchanged.
    title?: string;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
}

export interface GenerationParam {
    argName: string;
    sourceName: string;
    type: string;
    required: boolean;
    description: string;
    location: ParamLocation;
    schema?: Record<string, unknown>;
    style?: string;
    explode?: boolean;
}

export interface GenerationRequestBody {
    contentType: string;
    contentKind: RequestBodyContentKind;
    schema?: Record<string, unknown>;
    params: GenerationParam[];
}

export interface GeneratedProject {
    manifest: GeneratedManifest;
    files: Map<string, string>;
}

export interface GeneratedManifest {
    generatorVersion: string;
    contractVersion: number;
    language: ExportLanguage;
    framework: ExportFramework;
    features: GenerationFeatureFlags;
    transport: Transport;
    serverName: string;
    generatedAt: string;
    toolCount: number;
}

export interface GenerationIssue {
    severity: "error" | "warning" | "info";
    message: string;
    path?: string;
}

export interface ValidationResult {
    errors: GenerationIssue[];
    warnings: GenerationIssue[];
    info: GenerationIssue[];
}

export interface VerificationCheck {
    name: string;
    status: "passed" | "failed" | "skipped";
    details?: string;
}

export interface VerificationReport {
    status: "passed" | "failed";
    mode: VerificationMode;
    checks: VerificationCheck[];
}

export interface GeneratedPreviewResponse {
    files: Array<{ name: string; content: string }>;
    manifest: GeneratedManifest;
    validation: ValidationResult;
    verification?: VerificationReport;
}
