import type {
    GeneratedProject,
    GenerationPlan,
    GenerationRequestBody,
    GenerationTool,
    ToolAuthRequirementPlan,
} from "../types.ts";
import { collectAuthSchemes, getAuthSchemeKey } from "../strategies/auth.ts";
import { getNodeTransportStrategy, LOCALHOST_ORIGIN_HOSTS } from "../strategies/transport.ts";
import { renderGeneratedReadme } from "../readme.ts";
import { NODE_MCP_SDK_VERSION } from "../runtime-versions.ts";
import { renderDependabot, renderDependencyLock, renderLicenseSummary, renderProvenance, renderSbom, runtimePin } from "../supply-chain.ts";
import { toJsStringLiteral } from "../utils.ts";
import { schemaToZodType, toZodType } from "../schema.ts";
import {
    buildManifest,
    expectedSerializedParameterValue,
    getEnvExample,
    getExpectedJsonBody,
    getExpectedPath,
    getExpectedQueryEntries,
    getTestArgs,
    renderDockerCompose,
    scalarToExpectedString,
} from "./shared.ts";

function renderNodeSerializationOptions(param: GenerationTool["params"][number]): string {
    return `{ location: ${JSON.stringify(param.location)}, style: ${JSON.stringify(param.style)}, explode: ${param.explode === undefined ? "undefined" : String(param.explode)} }`;
}

function getNodeBodyExpression(requestBody: GenerationRequestBody): string {
    if (
        requestBody.contentKind === "rawJsonObject" ||
        requestBody.contentKind === "rawArray" ||
        requestBody.contentKind === "text" ||
        requestBody.contentKind === "binary"
    ) {
        const param = requestBody.params[0];
        return `args[${JSON.stringify(param?.argName || "body")}]`;
    }

    const properties = requestBody.params
        .map((param) => `      ${JSON.stringify(param.sourceName)}: args[${JSON.stringify(param.argName)}],`)
        .join("\n");

    return `{\n${properties}\n    }`;
}

function isMultipartBinaryParam(param: GenerationRequestBody["params"][number]): boolean {
    return param.schema?.format === "binary" || param.schema?.type === "file";
}

function renderNodeMultipartAppend(param: GenerationRequestBody["params"][number]): string {
    const argName = JSON.stringify(param.argName);
    const sourceName = JSON.stringify(param.sourceName);

    if (!isMultipartBinaryParam(param)) {
        return `      if (args[${argName}] !== undefined) formBody.append(${sourceName}, String(args[${argName}]));`;
    }

    return `      if (args[${argName}] !== undefined) {
        const fileBytes = Buffer.from(String(args[${argName}]), "base64");
        formBody.append(${sourceName}, new Blob([fileBytes]), ${sourceName});
      }`;
}

function renderNodeRequestBody(requestBody?: GenerationRequestBody): {
    setup: string;
    headerLines: string[];
    bodyOption: string;
} {
    if (!requestBody) {
        return { setup: "", headerLines: [], bodyOption: "" };
    }

    switch (requestBody.contentKind) {
        case "flattenedObject":
            return {
                setup: "",
                headerLines: [`      requestHeaders["Content-Type"] = ${JSON.stringify(requestBody.contentType)};`],
                bodyOption: `        body: JSON.stringify(${getNodeBodyExpression(requestBody)}),\n`,
            };
        case "rawJsonObject":
        case "rawArray":
            return {
                setup: "",
                headerLines: [`      requestHeaders["Content-Type"] = ${JSON.stringify(requestBody.contentType)};`],
                bodyOption: `        body: JSON.stringify(${getNodeBodyExpression(requestBody)}),\n`,
            };
        case "text":
            return {
                setup: "",
                headerLines: [`      requestHeaders["Content-Type"] = ${JSON.stringify(requestBody.contentType)};`],
                bodyOption: `        body: String(${getNodeBodyExpression(requestBody)} ?? ""),\n`,
            };
        case "formUrlencoded": {
            const setupLines = [
                "      const formBody = new URLSearchParams();",
                ...requestBody.params.map((param) => `      if (args[${JSON.stringify(param.argName)}] !== undefined) formBody.append(${JSON.stringify(param.sourceName)}, String(args[${JSON.stringify(param.argName)}]));`),
            ];

            return {
                setup: setupLines.join("\n"),
                headerLines: [`      requestHeaders["Content-Type"] = ${JSON.stringify(requestBody.contentType)};`],
                bodyOption: "        body: formBody,\n",
            };
        }
        case "multipart": {
            const setupLines = [
                "      const formBody = new FormData();",
                ...requestBody.params.map(renderNodeMultipartAppend),
            ];

            return {
                setup: setupLines.join("\n"),
                headerLines: [],
                bodyOption: "        body: formBody,\n",
            };
        }
        case "binary":
            return {
                setup: "",
                headerLines: [`      requestHeaders["Content-Type"] = ${JSON.stringify(requestBody.contentType)};`],
                bodyOption: `        body: Buffer.from(String(${getNodeBodyExpression(requestBody)}), "base64"),\n`,
            };
    }
}

function renderNodeAuthRequirements(requirements?: ToolAuthRequirementPlan[]): string {
    if (!requirements?.length) return "[]";

    const renderedRequirements = requirements.map((requirement) => {
        const schemes = requirement.schemes
            .map((scheme) => `AUTH_SCHEMES[${JSON.stringify(getAuthSchemeKey(scheme))}]`)
            .join(", ");
        return `{ schemes: [${schemes}] }`;
    });

    return `[\n    ${renderedRequirements.join(",\n    ")}\n  ]`;
}

function renderNodeOperation(tool: GenerationTool): string {
    const pathParams = tool.params.filter((param) => param.location === "path");
    const queryParams = tool.params.filter((param) => param.location === "query");
    const headerParams = tool.params.filter((param) => param.location === "header");
    const cookieParams = tool.params.filter((param) => param.location === "cookie");
    const bodyRender = renderNodeRequestBody(tool.requestBody);

    const pathReplacements = pathParams
        .map((param) => `  path = path.replace(${JSON.stringify(`{${param.sourceName}}`)}, serializePathParameter(${JSON.stringify(param.sourceName)}, args[${JSON.stringify(param.argName)}], ${renderNodeSerializationOptions(param)}));`)
        .join("\n");

    const queryLines = queryParams
        .map((param) => `  appendSerializedParameter(queryString, ${JSON.stringify(param.sourceName)}, args[${JSON.stringify(param.argName)}], ${renderNodeSerializationOptions(param)});`)
        .join("\n");

    const headerLines = headerParams
        .map((param) => `  if (args[${JSON.stringify(param.argName)}] !== undefined) requestHeaders[${JSON.stringify(param.sourceName)}] = serializeParameterValue(${JSON.stringify(param.sourceName)}, args[${JSON.stringify(param.argName)}], ${renderNodeSerializationOptions(param)});`)
        .join("\n");

    const cookieLines = cookieParams
        .map((param) => `  if (args[${JSON.stringify(param.argName)}] !== undefined) cookiePairs.push(\`${encodeURIComponent(param.sourceName)}=\${encodeURIComponent(serializeParameterValue(${JSON.stringify(param.sourceName)}, args[${JSON.stringify(param.argName)}], ${renderNodeSerializationOptions(param)}))}\`);`)
        .join("\n");

    const bodySetup = bodyRender.setup ? `${bodyRender.setup.replaceAll("      ", "  ")}\n` : "";
    const bodyHeaderLines = bodyRender.headerLines.map((line) => line.replace("      ", "  ")).join("\n");

    return `async function(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  let path = ${JSON.stringify(tool.path)};
${pathReplacements ? `${pathReplacements}\n` : ""}  const queryString = new URLSearchParams();
${queryLines ? `${queryLines}\n` : ""}  const requestHeaders: Record<string, string> = {};
  const cookiePairs: string[] = [];
${headerLines ? `${headerLines}\n` : ""}${cookieLines ? `${cookieLines}\n` : ""}${bodySetup}${bodyHeaderLines ? `${bodyHeaderLines}\n` : ""}  applyAuth(queryString, requestHeaders, cookiePairs, ${renderNodeAuthRequirements(tool.authStrategy.requirements)});
  if (cookiePairs.length > 0) {
    requestHeaders["Cookie"] = cookiePairs.join("; ");
  }

  return executeApiRequest({
    path,
    method: ${JSON.stringify(tool.method)},
    baseUrl: ${JSON.stringify(tool.baseUrl || "")},
    signal,
    query: queryString,
    headers: requestHeaders,
${bodyRender.bodyOption}  });
}`;
}

function isObjectSchemaWithProperties(schema?: Record<string, unknown>): boolean {
    return Boolean(
        schema &&
        schema.type === "object" &&
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties) &&
        Object.keys(schema.properties as Record<string, unknown>).length > 0
    );
}

// Render an MCP `annotations` object literal (MCP 2025-11-25). Behavioral hints
// derived from HTTP method semantics; advisory only.
function renderNodeAnnotations(annotations?: GenerationTool["annotations"]): string | undefined {
    if (!annotations) return undefined;

    const entries: string[] = [];
    if (annotations.title) entries.push(`      title: ${toJsStringLiteral(annotations.title)}`);
    if (annotations.readOnlyHint !== undefined) entries.push(`      readOnlyHint: ${annotations.readOnlyHint}`);
    if (annotations.destructiveHint !== undefined) entries.push(`      destructiveHint: ${annotations.destructiveHint}`);
    if (annotations.idempotentHint !== undefined) entries.push(`      idempotentHint: ${annotations.idempotentHint}`);
    if (annotations.openWorldHint !== undefined) entries.push(`      openWorldHint: ${annotations.openWorldHint}`);

    if (entries.length === 0) return undefined;
    return `{\n${entries.join(",\n")}\n    }`;
}

// Build the MCP `outputSchema` (a Zod raw shape) from the tool's derived JSON
// response schema. Object schemas with named properties map to a shape keyed by
// those properties; any other shape (array, primitive, unconstrained object) is
// wrapped as `{ result: <zod> }` because MCP output schemas must be object shapes.
// Returns undefined when there is no usable output schema.
function buildNodeOutputSchema(outputSchema?: Record<string, unknown>): { shape: string; wrapsResult: boolean } | undefined {
    if (!outputSchema || Object.keys(outputSchema).length === 0) return undefined;

    if (isObjectSchemaWithProperties(outputSchema)) {
        const properties = outputSchema.properties as Record<string, Record<string, unknown>>;
        const required = new Set((outputSchema.required || []) as string[]);
        const fields = Object.entries(properties).map(([key, propertySchema]) => {
            let value = schemaToZodType(propertySchema);
            if (!required.has(key)) value += ".optional()";
            return `      ${JSON.stringify(key)}: ${value}`;
        });
        return { shape: `{\n${fields.join(",\n")}\n    }`, wrapsResult: false };
    }

    return { shape: `{\n      result: ${schemaToZodType(outputSchema)}\n    }`, wrapsResult: true };
}

function renderNodeServerTool(tool: GenerationTool, operationIndex: number): string {
    const schemaFields = tool.params
        .map((param) => {
            let line = `      ${JSON.stringify(param.argName)}: ${toZodType(param.type, param.schema)}`;
            if (!param.required) {
                line += ".optional()";
            }
            if (param.description) {
                line += `.describe(${toJsStringLiteral(param.description)})`;
            }
            return `${line},`;
        })
        .join("\n");

    const output = buildNodeOutputSchema(tool.outputSchema);
    const annotations = renderNodeAnnotations(tool.annotations);

    const configEntries: string[] = [];
    if (tool.title) configEntries.push(`    title: ${toJsStringLiteral(tool.title)}`);
    configEntries.push(`    description: ${toJsStringLiteral(tool.description)}`);
    configEntries.push(`    inputSchema: {\n${schemaFields}\n    }`);
    if (output) configEntries.push(`    outputSchema: ${output.shape}`);
    if (annotations) configEntries.push(`    annotations: ${annotations}`);

    // With an outputSchema, the SDK requires the handler to return structuredContent.
    // Parse the operation's JSON text into structured content, wrapping non-object
    // payloads under `result` to match the wrapped output shape. Falls back to a
    // text-only result when the response body is not valid JSON.
    const successBody = output
        ? output.wrapsResult
            ? `      let structuredContent: Record<string, unknown> | undefined;
      try {
        structuredContent = { result: JSON.parse(text) };
      } catch {
        structuredContent = undefined;
      }
      return structuredContent
        ? { content: [{ type: "text" as const, text }], structuredContent }
        : { content: [{ type: "text" as const, text }] };`
            : `      let structuredContent: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(text);
        structuredContent = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : undefined;
      } catch {
        structuredContent = undefined;
      }
      return structuredContent
        ? { content: [{ type: "text" as const, text }], structuredContent }
        : { content: [{ type: "text" as const, text }] };`
        : `      return { content: [{ type: "text" as const, text }] };`;

    return `server.registerTool(
  ${JSON.stringify(tool.displayName)},
  {
${configEntries.join(",\n")}
  },
  async (args: Record<string, unknown>, extra) => {
    try {
      const text = await operations[${operationIndex}](args, extra.signal);
${successBody}
    } catch (error) {
      // Surface upstream HTTP failures and thrown errors as tool errors (isError)
      // so the model can self-correct rather than the transport failing.
      return {
        content: [{ type: "text" as const, text: \`Error: \${error instanceof Error ? error.message : "Unknown error"}\` }],
        isError: true,
      };
    }
  }
);`;
}

function renderIndex(plan: GenerationPlan): string {
    const transportStrategy = getNodeTransportStrategy(plan);
    // The transport bootstrap already reads host/port from MCP_SERVER_CONFIG at
    // runtime (see getNodeTransportStrategy), so index.ts embeds no host/port
    // literals to patch. Only the transport-agnostic scaffolding lives here.
    const bootstrap = transportStrategy.bootstrap;

    return `import "dotenv/config";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
${transportStrategy.imports}
import { ${plan.runtime.transport === "stdio" ? "MCP_SERVER_CONFIG" : "MCP_SERVER_CONFIG, assertMcpServerAccessConfig"} } from "./config.js";
import { createServer } from "./mcp/server.js";
${plan.runtime.transport === "stdio" ? "" : 'import { authorizeMcpRequest, handleMcpPreflight } from "./mcp/access.js";'}

async function main() {
${plan.runtime.transport === "stdio" ? "" : "  assertMcpServerAccessConfig();\n"}${bootstrap}
}

main().catch(console.error);
`;
}

function renderConfig(plan: GenerationPlan): string {
    const authSchemes = collectAuthSchemes(plan);
    const authSchemeEntries = authSchemes.map((auth) => {
        const scheme = auth.scheme;

        if (scheme.strategy === "apiKeyHeader" || scheme.strategy === "apiKeyQuery" || scheme.strategy === "apiKeyCookie") {
            return `  ${JSON.stringify(auth.key)}: { type: "apiKey", in: ${JSON.stringify(scheme.apiKeyLocation || "header")}, name: ${JSON.stringify(scheme.apiKeyName || "X-API-Key")}, value: process.env.${auth.apiKeyEnvVar} || "" },`;
        }

        if (scheme.strategy === "bearer") {
            return `  ${JSON.stringify(auth.key)}: { type: "bearer", token: process.env.${auth.bearerTokenEnvVar} || "" },`;
        }

        return `  ${JSON.stringify(auth.key)}: { type: "basic", username: process.env.${auth.basicUsernameEnvVar} || "", password: process.env.${auth.basicPasswordEnvVar} || "" },`;
    }).join("\n");

    return `import { config } from "dotenv";
import { fileURLToPath } from "node:url";
const envFile = new URL(import.meta.url.includes("/dist/src/") ? "../../.env" : "../.env", import.meta.url);
config({ path: fileURLToPath(envFile) });

export const API_BASE_URL = process.env.API_BASE_URL || "";
export const AUTH_SCHEMES = {
${authSchemeEntries}
} as const;

function parseMcpAllowedOrigins(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined || value.trim() === "") return [...fallback];
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export const MCP_SERVER_CONFIG = {
  name: ${JSON.stringify(plan.server.name)},
  version: ${JSON.stringify(plan.server.version)},
  host: process.env.MCP_HOST || ${JSON.stringify(plan.server.host)},
  port: Number(process.env.PORT || ${plan.server.port}),
} as const;

export const MCP_SERVER_ACCESS_CONFIG: {
  authType: "none" | "bearer";
  authToken: string;
  allowedOrigins: string[];
} = {
  authType: ${JSON.stringify(plan.mcpServerAuth.type)},
  authToken: ${plan.mcpServerAuth.type === "bearer" ? `process.env.${plan.mcpServerAuth.tokenEnvVar} || ""` : `""`},
  allowedOrigins: parseMcpAllowedOrigins(process.env.${plan.mcpServerAuth.allowedOriginsEnvVar}, ${JSON.stringify(plan.mcpServerAuth.allowedOrigins)}),
};

export function assertMcpServerAccessConfig() {
  if (MCP_SERVER_ACCESS_CONFIG.authType === "bearer" && !MCP_SERVER_ACCESS_CONFIG.authToken) {
    throw new Error("${plan.mcpServerAuth.tokenEnvVar} is required when MCP server bearer auth is enabled.");
  }
}
`;
}

function renderMcpAccess(): string {
    return `import { timingSafeEqual } from "node:crypto";
import { MCP_SERVER_ACCESS_CONFIG } from "../config.js";

type HeaderValue = string | string[] | undefined;
type McpAccessRequest = { method?: string; headers: Record<string, HeaderValue> };
type McpAccessResponse = {
  setHeader?(name: string, value: string): void;
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(body?: string): void;
};

// Hosts treated as local when no explicit allow-list is configured (deny-by-default).
const LOCALHOST_HOSTS = new Set<string>(${JSON.stringify([...LOCALHOST_ORIGIN_HOSTS])});

function getHeader(req: McpAccessRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    return LOCALHOST_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  // Requests without an Origin header (e.g. non-browser clients) are permitted.
  if (!origin) return true;
  // Deny-by-default: with no configured allow-list, only localhost origins are accepted
  // to guard against DNS-rebinding attacks against locally-bound HTTP transports.
  if (allowedOrigins.length === 0) return isLocalhostOrigin(origin);
  return allowedOrigins.includes(origin);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function isBearerAuthorized(authorization: string | undefined, token: string): boolean {
  if (!token || !authorization) return false;
  return timingSafeStringEqual(authorization, \`Bearer \${token}\`);
}

function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function applyCorsHeaders(res: McpAccessResponse, origin: string | undefined) {
  for (const [name, value] of Object.entries(getCorsHeaders(origin))) {
    res.setHeader?.(name, value);
  }
}

export function handleMcpPreflight(req: McpAccessRequest, res: McpAccessResponse): boolean {
  if (req.method !== "OPTIONS") return false;

  const origin = getHeader(req, "origin");
  if (!isOriginAllowed(origin, MCP_SERVER_ACCESS_CONFIG.allowedOrigins)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    return true;
  }

  res.writeHead(204, getCorsHeaders(origin));
  res.end();
  return true;
}

export function authorizeMcpRequest(req: McpAccessRequest, res: McpAccessResponse): boolean {
  const origin = getHeader(req, "origin");
  if (!isOriginAllowed(origin, MCP_SERVER_ACCESS_CONFIG.allowedOrigins)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    return false;
  }
  applyCorsHeaders(res, origin);

  if (MCP_SERVER_ACCESS_CONFIG.authType === "bearer") {
    if (!MCP_SERVER_ACCESS_CONFIG.authToken) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MCP_AUTH_TOKEN is required" }));
      return false;
    }

    const authorization = getHeader(req, "authorization");
    if (!isBearerAuthorized(authorization, MCP_SERVER_ACCESS_CONFIG.authToken)) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "Missing or invalid bearer token" }));
      return false;
    }
  }

  return true;
}
`;
}

function renderClient(): string {
    return `import { API_BASE_URL } from "../config.js";

export type ApiRequest = {
  path: string;
  baseUrl?: string;
  signal?: AbortSignal;
  method: string;
  query?: URLSearchParams;
  headers?: Record<string, string>;
  body?: BodyInit;
};

export type AuthScheme =
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; value: string }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

export type AuthRequirement = {
  schemes: readonly AuthScheme[];
};

function isAuthSchemeConfigured(scheme: AuthScheme): boolean {
  if (scheme.type === "apiKey") return Boolean(scheme.value);
  if (scheme.type === "bearer") return Boolean(scheme.token);
  return Boolean(scheme.username || scheme.password);
}

function isAuthRequirementConfigured(requirement: AuthRequirement): boolean {
  return requirement.schemes.every(isAuthSchemeConfigured);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((headerName) => headerName.toLowerCase() === normalizedName);
}

function hasCookie(cookiePairs: string[], name: string): boolean {
  const prefix = \`\${encodeURIComponent(name)}=\`;
  return cookiePairs.some((cookie) => cookie.startsWith(prefix));
}

export function applyAuth(
  queryString: URLSearchParams,
  headers: Record<string, string>,
  cookiePairs: string[],
  authRequirements: readonly AuthRequirement[]
) {
  const requirement = authRequirements.find(isAuthRequirementConfigured);
  if (!requirement) return;

  for (const scheme of requirement.schemes) {
    if (!isAuthSchemeConfigured(scheme)) continue;

    if (scheme.type === "apiKey") {
      if (scheme.in === "query" && !queryString.has(scheme.name)) {
        queryString.append(scheme.name, scheme.value);
      } else if (scheme.in === "cookie" && !hasCookie(cookiePairs, scheme.name)) {
        cookiePairs.push(\`\${encodeURIComponent(scheme.name)}=\${encodeURIComponent(scheme.value)}\`);
      } else if (scheme.in === "header" && !hasHeader(headers, scheme.name)) {
        headers[scheme.name] = scheme.value;
      }
    } else if (scheme.type === "bearer" && !hasHeader(headers, "Authorization")) {
      headers["Authorization"] = \`Bearer \${scheme.token}\`;
    } else if (scheme.type === "basic" && !hasHeader(headers, "Authorization")) {
      headers["Authorization"] = \`Basic \${Buffer.from(\`\${scheme.username}:\${scheme.password}\`).toString("base64")}\`;
    }
  }
}

export async function executeApiRequest(request: ApiRequest): Promise<string> {
  const baseUrl = API_BASE_URL || request.baseUrl || "https://api.example.com";
  let url = baseUrl.replace(/\\/$/, "") + request.path;
  if (request.query?.toString()) url += \`?\${request.query.toString()}\`;
  const deadline = AbortSignal.timeout(30_000);
  const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal,
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) throw new Error("Upstream response exceeded the 1 MiB limit.");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  if (!response.ok) throw new Error(\`Upstream returned HTTP \${response.status}.\`);
  const responseText = Buffer.concat(chunks).toString("utf8");
  if (!responseText) return "OK";
  try { return JSON.stringify(JSON.parse(responseText), null, 2); }
  catch { return responseText; }
}
`;
}

function renderSerialization(): string {
    return `export type SerializedParameterOptions = {
  location: "path" | "query" | "header" | "cookie";
  style?: string;
  explode?: boolean;
};

export function defaultParameterStyle(location: SerializedParameterOptions["location"]): string {
  if (location === "path" || location === "header") return "simple";
  return "form";
}

export function shouldExplode(style: string, explode?: boolean): boolean {
  return explode ?? style === "form";
}

export function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

export function objectEntries(value: unknown): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(([, entryValue]) => entryValue !== undefined);
}

export function serializeParameterValue(name: string, value: unknown, options: SerializedParameterOptions): string {
  const style = options.style || defaultParameterStyle(options.location);
  const explode = shouldExplode(style, options.explode);
  const delimiter = style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";

  if (Array.isArray(value)) {
    return value.map(scalarToString).join(delimiter);
  }

  const entries = objectEntries(value);
  if (entries.length > 0) {
    if (explode) {
      return entries.map(([key, entryValue]) => \`\${key}=\${scalarToString(entryValue)}\`).join(delimiter);
    }
    return entries.flatMap(([key, entryValue]) => [key, scalarToString(entryValue)]).join(delimiter);
  }

  return scalarToString(value);
}

export function serializePathParameter(name: string, value: unknown, options: SerializedParameterOptions): string {
  const style = options.style || "simple";
  const explode = shouldExplode(style, options.explode);
  const encode = (entry: unknown) => encodeURIComponent(scalarToString(entry));
  const encodedName = encodeURIComponent(name);

  if (Array.isArray(value)) {
    const encodedValues = value.map(encode);
    if (style === "label") return \`.\${encodedValues.join(".")}\`;
    if (style === "matrix") {
      return explode
        ? encodedValues.map((entry) => \`;\${encodedName}=\${entry}\`).join("")
        : \`;\${encodedName}=\${encodedValues.join(",")}\`;
    }
    return encodedValues.join(",");
  }

  const entries = objectEntries(value);
  if (entries.length > 0) {
    if (style === "label") {
      const values = explode
        ? entries.map(([key, entryValue]) => \`\${encodeURIComponent(key)}=\${encode(entryValue)}\`)
        : entries.flatMap(([key, entryValue]) => [encodeURIComponent(key), encode(entryValue)]);
      return \`.\${values.join(".")}\`;
    }
    if (style === "matrix") {
      if (explode) {
        return entries.map(([key, entryValue]) => \`;\${encodeURIComponent(key)}=\${encode(entryValue)}\`).join("");
      }
      const values = entries.flatMap(([key, entryValue]) => [encodeURIComponent(key), encode(entryValue)]);
      return \`;\${encodedName}=\${values.join(",")}\`;
    }
    const values = explode
      ? entries.map(([key, entryValue]) => \`\${encodeURIComponent(key)}=\${encode(entryValue)}\`)
      : entries.flatMap(([key, entryValue]) => [encodeURIComponent(key), encode(entryValue)]);
    return values.join(",");
  }

  const encodedValue = encode(value);
  if (style === "label") return \`.\${encodedValue}\`;
  if (style === "matrix") return \`;\${encodedName}=\${encodedValue}\`;
  return encodedValue;
}

export function appendSerializedParameter(
  params: URLSearchParams,
  name: string,
  value: unknown,
  options: SerializedParameterOptions
) {
  if (value === undefined || value === null) return;

  const style = options.style || "form";
  const explode = shouldExplode(style, options.explode);

  if (Array.isArray(value)) {
    if (style === "form" && explode) {
      for (const entry of value) params.append(name, scalarToString(entry));
      return;
    }
    params.append(name, serializeParameterValue(name, value, { ...options, style, explode }));
    return;
  }

  const entries = objectEntries(value);
  if (entries.length > 0) {
    if (style === "deepObject") {
      for (const [key, entryValue] of entries) params.append(\`\${name}[\${key}]\`, scalarToString(entryValue));
      return;
    }
    if (style === "form" && explode) {
      for (const [key, entryValue] of entries) params.append(key, scalarToString(entryValue));
      return;
    }
    params.append(name, serializeParameterValue(name, value, { ...options, style, explode }));
    return;
  }

  params.append(name, scalarToString(value));
}
`;
}

function renderOperations(plan: GenerationPlan): string {
    return `import { AUTH_SCHEMES } from "../config.js";
import { applyAuth, executeApiRequest } from "./client.js";
import {
  appendSerializedParameter,
  serializeParameterValue,
  serializePathParameter,
} from "./serialization.js";

export const operations = [
${plan.tools.map((tool) => `  ${renderNodeOperation(tool)}`).join(",\n")}
] as const;
`;
}

// ---------------------------------------------------------------------------
// COMPACT MODE (meta-tools) — Node target
//
// When `plan.runtime.compactMode` is true the server registers exactly three
// meta-tools (list/get/invoke) instead of one tool per operation. All three read
// from a single immutable in-memory registry (`META_OPERATIONS`) built from
// `plan.tools`, keyed by tool id. `invoke_api_endpoint` dispatches through the
// SAME per-operation request functions (`operations[]`) used in non-compact mode,
// so request building / auth is never reinvented. See the DESIGN CONTRACT on
// GenerationPlan.runtime.compactMode in types.ts.
// ---------------------------------------------------------------------------

// Build the Zod raw-shape body for one operation's flat argument object. Mirrors
// the inputSchema emitted per-operation in renderNodeServerTool so invoke's
// validation matches exactly what a non-compact tool would enforce.
function renderCompactValidatorShape(tool: GenerationTool): string {
    if (tool.params.length === 0) return "{}";
    const fields = tool.params
        .map((param) => {
            let line = `      ${JSON.stringify(param.argName)}: ${toZodType(param.type, param.schema)}`;
            if (!param.required) line += ".optional()";
            return `${line},`;
        })
        .join("\n");
    return `{\n${fields}\n    }`;
}

// Lightweight, secret-free auth descriptor for get_api_endpoint_schema output.
function renderCompactAuthDescriptor(tool: GenerationTool): string {
    const requirements = tool.authStrategy.requirements;
    if (!requirements?.length) return "[]";
    const schemes = new Map<string, string>();
    for (const requirement of requirements) {
        for (const scheme of requirement.schemes) {
            const entry: Record<string, unknown> = { type: scheme.strategy, name: scheme.schemeName };
            if (scheme.apiKeyName) entry.apiKeyName = scheme.apiKeyName;
            if (scheme.apiKeyLocation) entry.in = scheme.apiKeyLocation;
            schemes.set(`${scheme.strategy}:${scheme.schemeName}`, JSON.stringify(entry));
        }
    }
    return `[${[...schemes.values()].join(", ")}]`;
}

// One immutable registry entry. `parameters` describes how the model-supplied
// { path, query, header, body } object maps back onto the flat args the stored
// operation function expects; `validator` is the compiled Zod schema; `invoke`
// is the stored per-operation request function (dispatch never rebuilds a URL).
function renderCompactRegistryEntry(tool: GenerationTool, index: number): string {
    const parameterDescriptors = tool.params
        .map((param) => `      { name: ${JSON.stringify(param.argName)}, in: ${JSON.stringify(param.location)}, required: ${param.required}, schema: ${JSON.stringify(param.schema ?? {})} }`)
        .join(",\n");

    const output = buildNodeOutputSchema(tool.outputSchema);
    const bodyParamNames = tool.requestBody?.params.map((param) => param.argName) ?? [];

    const entries: string[] = [
        `    id: ${JSON.stringify(tool.id)}`,
        `    method: ${JSON.stringify(tool.method)}`,
        `    path: ${JSON.stringify(tool.path)}`,
        `    summary: ${toJsStringLiteral((tool.title || tool.description || "").slice(0, 120))}`,
        `    description: ${toJsStringLiteral(tool.description)}`,
        `    tags: [] as string[]`,
        `    parameters: [\n${parameterDescriptors}\n    ]`,
        `    bodyContentKind: ${JSON.stringify(tool.requestBody?.contentKind ?? null)}`,
        `    bodyParamNames: ${JSON.stringify(bodyParamNames)}`,
        `    requestBody: ${JSON.stringify(tool.requestBody?.schema ?? null)}`,
        `    outputSchema: ${output ? output.shape : "undefined"}`,
        `    auth: ${renderCompactAuthDescriptor(tool)}`,
        `    validator: z.object(${renderCompactValidatorShape(tool)}).strict()`,
        `    operationIndex: ${index}`,
    ];

    return `  {\n${entries.join(",\n")}\n  }`;
}

function renderCompactServer(plan: GenerationPlan): string {
    const registryEntries = plan.tools.map(renderCompactRegistryEntry).join(",\n");

    return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_SERVER_CONFIG } from "../config.js";
import { operations } from "../api/operations.js";

// Maximum characters of upstream response returned in a single invoke envelope.
// Bounds the context cost of one call regardless of API payload size.
const MAX_INVOKE_RESULT_CHARS = 100_000;

type MetaParameter = { name: string; in: string; required: boolean; schema: Record<string, unknown> };
type MetaValidator = { safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: { issues: unknown } } };
type MetaOperation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: MetaParameter[];
  bodyContentKind: string | null;
  bodyParamNames: string[];
  requestBody: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown>;
  auth: Array<Record<string, unknown>>;
  validator: MetaValidator;
  operationIndex: number;
};

// Immutable operation registry — the single source of truth for all three
// meta-tools. The id space is CLOSED: invoke can only ever reach a real,
// generated operation. Frozen so it cannot be mutated at runtime.
const META_OPERATIONS: readonly MetaOperation[] = Object.freeze([
${registryEntries}
]);

const META_OPERATIONS_BY_ID: ReadonlyMap<string, MetaOperation> = new Map(
  META_OPERATIONS.map((operation) => [operation.id, operation] as const)
);

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// Flatten the model-supplied { path, query, header, body } object onto the flat,
// argName-keyed args object the stored operation function expects. Values are
// read strictly by the registry's parameter descriptors — never from arbitrary
// keys — so the model cannot smuggle in unknown parameters.
function toOperationArgs(
  operation: MetaOperation,
  parameters: { path?: unknown; query?: unknown; header?: unknown; body?: unknown } | undefined
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const buckets: Record<string, Record<string, unknown>> = {
    path: asObject(parameters?.path),
    query: asObject(parameters?.query),
    header: asObject(parameters?.header),
    cookie: asObject((parameters as Record<string, unknown> | undefined)?.cookie),
  };

  for (const parameter of operation.parameters) {
    if (parameter.in === "body") continue;
    const bucket = buckets[parameter.in];
    if (bucket && parameter.name in bucket) {
      args[parameter.name] = bucket[parameter.name];
    }
  }

  // Request body. A single raw body param takes the whole \`body\`; a flattened
  // object body maps each named field out of the \`body\` object by argName.
  const body = parameters?.body;
  if (operation.bodyContentKind === "rawJsonObject" || operation.bodyContentKind === "rawArray" || operation.bodyContentKind === "text" || operation.bodyContentKind === "binary") {
    if (operation.bodyParamNames[0] !== undefined) args[operation.bodyParamNames[0]] = body;
  } else if (operation.bodyParamNames.length > 0) {
    const bodyObject = asObject(body);
    for (const name of operation.bodyParamNames) {
      if (name in bodyObject) args[name] = bodyObject[name];
    }
  }

  return args;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function boundedResult(text: string): { data: unknown; truncated: boolean } {
  const truncated = text.length > MAX_INVOKE_RESULT_CHARS;
  const bounded = truncated ? text.slice(0, MAX_INVOKE_RESULT_CHARS) : text;
  try {
    return { data: JSON.parse(bounded), truncated };
  } catch {
    return { data: bounded, truncated };
  }
}

export function createServer() {
  const server = new McpServer({
    name: MCP_SERVER_CONFIG.name,
    version: MCP_SERVER_CONFIG.version,
  });

  const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

  server.registerTool(
    "list_api_endpoints",
    {
      title: "List API Endpoints",
      description: "Search and list available API operations. Returns lightweight records (id, method, path, summary, tags) — NOT full parameter schemas. Call get_api_endpoint_schema before invoking.",
      inputSchema: {
        search: z.string().optional().describe("Free-text over id, summary, description, path. Omit to browse all."),
        tag: z.string().optional().describe("Filter to one tag / resource group."),
        method: z.enum(HTTP_METHODS).optional().describe("Filter by HTTP method."),
        limit: z.number().int().min(1).max(100).optional().describe("Max records to return (default 50)."),
        cursor: z.string().optional().describe("Opaque cursor from a previous response's next_cursor."),
      },
      annotations: {
        title: "List API Endpoints",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: { search?: string; tag?: string; method?: string; limit?: number; cursor?: string }) => {
      const search = args.search?.trim().toLowerCase();
      const tag = args.tag?.trim().toLowerCase();
      const method = args.method?.toUpperCase();
      const limit = args.limit ?? 50;
      const offset = decodeCursor(args.cursor);

      const matches = META_OPERATIONS.filter((operation) => {
        if (method && operation.method !== method) return false;
        if (tag && !operation.tags.some((entry) => entry.toLowerCase() === tag)) return false;
        if (search) {
          const haystack = \`\${operation.id} \${operation.method} \${operation.path} \${operation.summary} \${operation.description} \${operation.tags.join(" ")}\`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

      const page = matches.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const structuredContent = {
        endpoints: page.map((operation) => ({
          id: operation.id,
          method: operation.method,
          path: operation.path,
          summary: operation.summary,
          tags: operation.tags,
        })),
        next_cursor: nextOffset < matches.length ? encodeCursor(nextOffset) : undefined,
        total_estimate: matches.length,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    }
  );

  server.registerTool(
    "get_api_endpoint_schema",
    {
      title: "Get API Endpoint Schema",
      description: "Get the full input (parameters + request body) and output schema, plus description, for one operation by id. Call after list_api_endpoints and before invoke_api_endpoint.",
      inputSchema: {
        endpointId: z.string().describe("The endpoint id returned by list_api_endpoints."),
      },
      annotations: {
        title: "Get API Endpoint Schema",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: { endpointId: string }) => {
      const operation = META_OPERATIONS_BY_ID.get(args.endpointId);
      if (!operation) {
        const payload = { error: { type: "unknown_operation", message: \`Unknown endpoint id: \${args.endpointId}\` } };
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
      }

      const structuredContent = {
        id: operation.id,
        method: operation.method,
        path: operation.path,
        summary: operation.summary,
        description: operation.description,
        parameters: operation.parameters.filter((parameter) => parameter.in !== "body").map((parameter) => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required,
          schema: parameter.schema,
        })),
        requestBody: operation.requestBody ?? undefined,
        auth: operation.auth,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    }
  );

  server.registerTool(
    "invoke_api_endpoint",
    {
      title: "Invoke API Endpoint",
      description: "Invoke one operation by id. Arguments are validated against that operation's schema before any request is made.",
      inputSchema: {
        endpointId: z.string().describe("The endpoint id to invoke."),
        parameters: z.object({
          path: z.record(z.unknown()).optional(),
          query: z.record(z.unknown()).optional(),
          header: z.record(z.unknown()).optional(),
          body: z.unknown().optional(),
        }).optional().describe("Inputs by location, plus a body key for the request body."),
      },
      annotations: {
        title: "Invoke API Endpoint",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: { endpointId: string; parameters?: { path?: unknown; query?: unknown; header?: unknown; body?: unknown } }, extra) => {
      const respond = (payload: Record<string, unknown>, isError: boolean) => ({
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...(isError ? { isError: true } : {}),
      });

      // (a) Closed registry — refuse unknown ids and make NO HTTP call.
      const operation = META_OPERATIONS_BY_ID.get(args.endpointId);
      if (!operation) {
        return respond({ ok: false, endpointId: args.endpointId, error: { type: "unknown_operation", message: \`Unknown endpoint id: \${args.endpointId}\` } }, true);
      }

      // Map the { path, query, header, body } object onto flat operation args by
      // the registry's parameter descriptors (never arbitrary model keys).
      const operationArgs = toOperationArgs(operation, args.parameters);

      // (b) Validate BEFORE any network I/O against the stored operation schema.
      const validation = operation.validator.safeParse(operationArgs);
      if (!validation.success) {
        return respond({ ok: false, endpointId: operation.id, error: { type: "validation_error", message: "Arguments failed schema validation.", details: validation.error.issues } }, true);
      }

      // (c) Dispatch through the stored per-operation request function, which
      // builds the request from the operation's method + path template and
      // (d) applies auth server-side from config/env. The model never supplies a
      // URL or secret.
      try {
        const text = await operations[operation.operationIndex](validation.data as Record<string, unknown>, extra.signal);
        const { data, truncated } = boundedResult(text);
        return respond({ ok: true, status: 200, endpointId: operation.id, data, ...(truncated ? { truncated: true } : {}) }, false);
      } catch (error) {
        return respond({ ok: false, endpointId: operation.id, error: { type: "http_error", message: error instanceof Error ? error.message : "Unknown error" } }, true);
      }
    }
  );

  return server;
}
`;
}

function renderServer(plan: GenerationPlan): string {
    if (plan.runtime.compactMode) {
        return renderCompactServer(plan);
    }

    return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_SERVER_CONFIG } from "../config.js";
import { operations } from "../api/operations.js";

export function createServer() {
  const server = new McpServer({
    name: MCP_SERVER_CONFIG.name,
    version: MCP_SERVER_CONFIG.version,
  });

${plan.tools.map((tool, index) => renderNodeServerTool(tool, index)).join("\n\n")}

  return server;
}
`;
}

function renderReadme(plan: GenerationPlan): string {
    const install = `${plan.runtime.packageManager} install`;
    const dev = plan.runtime.packageManager === "npm" ? "npm run dev" : `${plan.runtime.packageManager} dev`;
    const build = plan.runtime.packageManager === "npm" ? "npm run build" : `${plan.runtime.packageManager} build`;
    const start = plan.runtime.packageManager === "npm" ? "npm run start" : `${plan.runtime.packageManager} start`;

    return renderGeneratedReadme(plan, {
        installCommand: install,
        runCommand: dev,
        buildCommands: [build, start],
        stdioClientCommand: "node",
        stdioClientArgs: ["dist/src/index.js"],
        runtimeDependencies: [
            { name: "@modelcontextprotocol/sdk", version: NODE_MCP_SDK_VERSION },
        ],
    });
}

function renderDockerfile(plan: GenerationPlan): string {
    // Multi-stage build: compile in a build stage, ship a lean non-root runtime.
    // stdio:  docker run -i --rm IMAGE
    // HTTP: select HTTP when generating, then publish the configured port.
    return `# ---- Build stage ----
FROM node:22.17.0-alpine3.22 AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
${plan.features.tests ? "COPY tests ./tests\n" : ""}COPY mcpmint.manifest.json ./mcpmint.manifest.json
RUN npm run build
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:22.17.0-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
ENV MCP_HOST=0.0.0.0
ENV PORT=${plan.server.port}
EXPOSE ${plan.server.port}
ENTRYPOINT ["node", "dist/src/index.js"]
`;
}

// The registry `server.json` name is reverse-DNS + "/" + server id
// (^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$). Default the namespace to the GitHub-verified
// form (io.github.<owner>) since that is the simplest ownership path; owners edit
// the placeholder owner before publishing.
const SERVER_JSON_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function sanitizeServerId(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return cleaned || "mcp-server";
}

function toRegistryTransportType(plan: GenerationPlan): "stdio" | "streamable-http" | "sse" {
    if (plan.runtime.transport === "http") return "streamable-http";
    if (plan.runtime.transport === "sse") return "sse";
    return "stdio";
}

function buildServerJsonEnvironmentVariables(plan: GenerationPlan): Array<Record<string, unknown>> {
    const variables: Array<Record<string, unknown>> = [
        { name: "API_BASE_URL", description: "Base URL for upstream API requests.", isRequired: false, isSecret: false },
    ];

    for (const auth of collectAuthSchemes(plan)) {
        if (auth.apiKeyEnvVar) variables.push({ name: auth.apiKeyEnvVar, description: "API key for the upstream API.", isRequired: false, isSecret: true });
        if (auth.bearerTokenEnvVar) variables.push({ name: auth.bearerTokenEnvVar, description: "Bearer token for the upstream API.", isRequired: false, isSecret: true });
        if (auth.basicUsernameEnvVar) variables.push({ name: auth.basicUsernameEnvVar, description: "Basic auth username for the upstream API.", isRequired: false, isSecret: false });
        if (auth.basicPasswordEnvVar) variables.push({ name: auth.basicPasswordEnvVar, description: "Basic auth password for the upstream API.", isRequired: false, isSecret: true });
    }

    if (plan.runtime.transport !== "stdio" && plan.mcpServerAuth.type === "bearer") {
        variables.push({ name: plan.mcpServerAuth.tokenEnvVar, description: "Bearer token protecting MCP server access over HTTP/SSE.", isRequired: true, isSecret: true });
    }

    return variables;
}

// Emit a registry-ready server.json (npm/npx variant) per the MCP registry schema.
// `identifier`, `version`, and the top-level `version` are kept in sync with the
// package version; owners replace the placeholder namespace/repository before publishing.
function renderServerJson(plan: GenerationPlan): string {
    const serverId = sanitizeServerId(plan.server.name);
    const description = (plan.spec.description?.trim() || `MCP server generated from ${plan.spec.title}.`).slice(0, 100);

    return `${JSON.stringify({
        $schema: SERVER_JSON_SCHEMA_URL,
        name: `io.github.OWNER/${serverId}`,
        description,
        title: plan.spec.title,
        repository: { url: "https://github.com/OWNER/REPO", source: "github" },
        version: plan.server.version,
        packages: [
            {
                registryType: "npm",
                registryBaseUrl: "https://registry.npmjs.org",
                identifier: plan.server.name,
                version: plan.server.version,
                runtimeHint: "npx",
                transport: { type: toRegistryTransportType(plan) },
                environmentVariables: buildServerJsonEnvironmentVariables(plan),
            },
        ],
    }, null, 2)}\n`;
}

function renderNodeAuthEnvAssignments(plan: GenerationPlan): string {
    const assignments: string[] = [`process.env.API_BASE_URL = "https://unit.example.test";`];

    for (const auth of collectAuthSchemes(plan)) {
        if (auth.apiKeyEnvVar) assignments.push(`process.env.${auth.apiKeyEnvVar} = "test-api-key";`);
        if (auth.bearerTokenEnvVar) assignments.push(`process.env.${auth.bearerTokenEnvVar} = "test-bearer-token";`);
        if (auth.basicUsernameEnvVar) assignments.push(`process.env.${auth.basicUsernameEnvVar} = "test-user";`);
        if (auth.basicPasswordEnvVar) assignments.push(`process.env.${auth.basicPasswordEnvVar} = "test-pass";`);
    }

    return assignments.join("\n");
}

function renderNodeMcpAccessBehaviorTest(plan: GenerationPlan): string {
    if (plan.runtime.transport === "stdio") return "";

    const allowedOrigin = plan.mcpServerAuth.allowedOrigins[0] || "http://localhost:3000";
    const allowedOrigins = JSON.stringify([allowedOrigin]);

    return `
test("MCP server access helpers enforce bearer tokens and allowed origins", () => {
  assert.equal(isOriginAllowed(undefined, ${allowedOrigins}), true);
  assert.equal(isOriginAllowed(${JSON.stringify(allowedOrigin)}, ${allowedOrigins}), true);
  assert.equal(isOriginAllowed("https://evil.example.test", ${allowedOrigins}), false);
  // Deny-by-default when no allow-list is configured: only localhost origins are accepted.
  assert.equal(isOriginAllowed("https://evil.example.test", []), false);
  assert.equal(isOriginAllowed("http://localhost:3000", []), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:8080", []), true);

  assert.equal(isBearerAuthorized(undefined, ""), false);
  assert.equal(isBearerAuthorized("Bearer secret", "secret"), true);
  assert.equal(isBearerAuthorized(undefined, "secret"), false);
  assert.equal(isBearerAuthorized("Bearer wrong", "secret"), false);

  const writes: Array<{ statusCode: number; headers?: Record<string, string> }> = [];
  const handled = handleMcpPreflight(
    { method: "OPTIONS", headers: { origin: ${JSON.stringify(allowedOrigin)} } },
    { writeHead: (statusCode: number, headers?: Record<string, string>) => writes.push({ statusCode, headers }), end: () => undefined }
  );
  assert.equal(handled, true);
  assert.equal(writes[0].statusCode, 204);
  assert.equal(writes[0].headers?.["Access-Control-Allow-Origin"], ${JSON.stringify(allowedOrigin)});

  const deniedWrites: Array<{ statusCode: number; headers?: Record<string, string> }> = [];
  const deniedHandled = handleMcpPreflight(
    { method: "OPTIONS", headers: { origin: "https://evil.example.test" } },
    { writeHead: (statusCode: number, headers?: Record<string, string>) => deniedWrites.push({ statusCode, headers }), end: () => undefined }
  );
  assert.equal(deniedHandled, true);
  assert.equal(deniedWrites.length, 1);
  assert.equal(deniedWrites[0].statusCode, 403);
});
`;
}

function renderNodeOperationBehaviorTest(tool: GenerationTool, index: number): string {
    const args = getTestArgs(tool);
    const expectedPath = getExpectedPath(tool, args);
    const expectedQueryEntries = getExpectedQueryEntries(tool, args);
    const headerParams = tool.params.filter((param) => param.location === "header");
    const cookieParams = tool.params.filter((param) => param.location === "cookie");
    const requestBody = tool.requestBody;
    const assertions: string[] = [
        `  assert.equal(call.init.method, ${JSON.stringify(tool.method)});`,
        `  assert.equal(url.pathname, ${JSON.stringify(expectedPath)});`,
    ];

    for (const [name, value] of expectedQueryEntries) {
        assertions.push(`  assert.ok(url.searchParams.getAll(${JSON.stringify(name)}).includes(${JSON.stringify(value)}));`);
    }

    for (const param of headerParams) {
        assertions.push(`  assert.equal(headers[${JSON.stringify(param.sourceName)}], ${JSON.stringify(expectedSerializedParameterValue(param.sourceName, args[param.argName], { location: "header", style: param.style, explode: param.explode }))});`);
    }

    for (const param of cookieParams) {
        assertions.push(`  assert.ok((headers.Cookie || "").includes(${JSON.stringify(`${encodeURIComponent(param.sourceName)}=${encodeURIComponent(expectedSerializedParameterValue(param.sourceName, args[param.argName], { location: "cookie", style: param.style, explode: param.explode }))}`)}));`);
    }

    if (requestBody?.contentKind === "flattenedObject" || requestBody?.contentKind === "rawJsonObject" || requestBody?.contentKind === "rawArray") {
        assertions.push(`  assert.equal(headers["Content-Type"], ${JSON.stringify(requestBody.contentType)});`);
        assertions.push(`  assert.deepEqual(JSON.parse(String(call.init.body)), ${JSON.stringify(getExpectedJsonBody(tool, args))});`);
    } else if (requestBody?.contentKind === "formUrlencoded") {
        const entries = requestBody.params.map((param) => [param.sourceName, scalarToExpectedString(args[param.argName])]);
        assertions.push(`  assert.equal(headers["Content-Type"], ${JSON.stringify(requestBody.contentType)});`);
        assertions.push(`  assert.ok(call.init.body instanceof URLSearchParams);`);
        assertions.push(`  assert.deepEqual(Array.from((call.init.body as URLSearchParams).entries()), ${JSON.stringify(entries)});`);
    } else if (requestBody?.contentKind === "multipart") {
        assertions.push(`  assert.ok(call.init.body instanceof FormData);`);
        for (const param of requestBody.params) {
            if (isMultipartBinaryParam(param)) {
                assertions.push(`  assert.ok((call.init.body as FormData).get(${JSON.stringify(param.sourceName)}) instanceof Blob);`);
            } else {
                assertions.push(`  assert.equal((call.init.body as FormData).get(${JSON.stringify(param.sourceName)}), ${JSON.stringify(scalarToExpectedString(args[param.argName]))});`);
            }
        }
    } else if (requestBody?.contentKind === "text") {
        assertions.push(`  assert.equal(headers["Content-Type"], ${JSON.stringify(requestBody.contentType)});`);
        assertions.push(`  assert.equal(call.init.body, ${JSON.stringify(scalarToExpectedString(args[requestBody.params[0]?.argName || "body"]))});`);
    } else if (requestBody?.contentKind === "binary") {
        assertions.push(`  assert.equal(headers["Content-Type"], ${JSON.stringify(requestBody.contentType)});`);
        assertions.push(`  assert.deepEqual(call.init.body, Buffer.from(String(args[${JSON.stringify(requestBody.params[0]?.argName || "body")}]), "base64"));`);
    }

    return `test(${JSON.stringify(`${tool.displayName} operation builds an API request`)}, async () => {
  const args = ${JSON.stringify(args, null, 2)};
  await operations[${index}](args);
  const call = lastFetchCall();
  const url = new URL(call.url);
  const headers = call.init.headers as Record<string, string>;
${assertions.join("\n")}
});`;
}

function renderNodeTest(plan: GenerationPlan): string {
    return `import test from "node:test";
import assert from "node:assert/strict";

${renderNodeAuthEnvAssignments(plan)}

type FetchCall = { url: string; init: RequestInit };

const fetchCalls: FetchCall[] = [];
let nextResponse = { ok: true, status: 200, body: JSON.stringify({ ok: true }) };
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  fetchCalls.push({ url: String(url), init: init || {} });
  const response = nextResponse;
  nextResponse = { ok: true, status: 200, body: JSON.stringify({ ok: true }) };
  return new Response(response.body, { status: response.status });
}) as typeof fetch;

const { applyAuth, executeApiRequest } = await import("../src/api/client.js");
const { appendSerializedParameter, serializePathParameter } = await import("../src/api/serialization.js");
const { operations } = await import("../src/api/operations.js");
${plan.runtime.transport === "stdio" ? "" : 'const { handleMcpPreflight, isBearerAuthorized, isOriginAllowed } = await import("../src/mcp/access.js");'}

test.after(() => {
  globalThis.fetch = originalFetch;
});

test.beforeEach(() => {
  fetchCalls.length = 0;
  nextResponse = { ok: true, status: 200, body: JSON.stringify({ ok: true }) };
});

function lastFetchCall(): FetchCall {
  const call = fetchCalls.at(-1);
  if (!call) throw new Error("Expected fetch to be called");
  return call;
}

test("executeApiRequest constructs URLs and reports HTTP errors", async () => {
  await executeApiRequest({
    path: "/reports/alpha",
    method: "GET",
    query: new URLSearchParams([["q", "a b"]]),
    headers: { Accept: "application/json" },
  });

  let call = lastFetchCall();
  assert.equal(call.url, "https://unit.example.test/reports/alpha?q=a+b");
  assert.equal(call.init.method, "GET");
  assert.deepEqual(call.init.headers, { Accept: "application/json" });

  nextResponse = { ok: false, status: 418, body: "teapot" };
  await assert.rejects(
    executeApiRequest({ path: "/failure", method: "POST" }),
    /Upstream returned HTTP 418\./
  );
});

test("upstream reads are bounded and private error bodies are redacted", async () => {
  nextResponse = { ok: true, status: 200, body: "x".repeat(1_048_577) };
  await assert.rejects(executeApiRequest({ path: "/large", method: "GET" }), /1 MiB limit/);
  assert.equal(lastFetchCall().init.redirect, "error");
  assert.ok(lastFetchCall().init.signal instanceof AbortSignal);
  nextResponse = { ok: false, status: 500, body: "private upstream diagnostic" };
  await assert.rejects(executeApiRequest({ path: "/private", method: "GET" }), { message: "Upstream returned HTTP 500." });
});

test("serialization helpers encode paths and queries", () => {
  assert.equal(
    serializePathParameter("ids", ["a", "b"], { location: "path", style: "matrix", explode: true }),
    ";ids=a;ids=b"
  );

  const params = new URLSearchParams();
  appendSerializedParameter(params, "filter", { status: "open" }, { location: "query", style: "deepObject", explode: true });
  appendSerializedParameter(params, "tags", ["a", "b"], { location: "query", style: "form", explode: true });
  assert.equal(params.toString(), "filter%5Bstatus%5D=open&tags=a&tags=b");
});

test("applyAuth injects headers, query parameters, and cookies", () => {
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};
  const cookies: string[] = [];

  applyAuth(query, headers, cookies, [{
    schemes: [
      { type: "apiKey", in: "header", name: "X-API-Key", value: "key" },
      { type: "apiKey", in: "query", name: "api_key", value: "query-key" },
      { type: "apiKey", in: "cookie", name: "session", value: "cookie-value" },
    ],
  }]);

  assert.equal(headers["X-API-Key"], "key");
  assert.equal(query.get("api_key"), "query-key");
  assert.deepEqual(cookies, ["session=cookie-value"]);
});

${renderNodeMcpAccessBehaviorTest(plan)}
${plan.tools.map(renderNodeOperationBehaviorTest).join("\n\n")}
`;
}

export function generateNodeProject(plan: GenerationPlan): GeneratedProject {
    const files = new Map<string, string>();
    const manifest = buildManifest(plan, "node");

    files.set("package.json", JSON.stringify({
        name: plan.server.name,
        version: plan.server.version,
        type: "module",
        // Cross-check field for the MCP registry: must equal the server.json `name`,
        // proving the published package and the registry entry share an owner.
        mcpName: `io.github.OWNER/${sanitizeServerId(plan.server.name)}`,
        scripts: {
            build: "tsc",
            start: "node dist/src/index.js",
            dev: "tsx src/index.ts",
            test: "tsx --test tests/**/*.test.ts",
        },
        dependencies: {
            "@modelcontextprotocol/sdk": NODE_MCP_SDK_VERSION,
            dotenv: "16.4.7",
            zod: "3.25.76",
        },
        devDependencies: {
            "@types/node": "20.19.43",
            tsx: "4.23.15",
            typescript: "5.9.3",
        },
    }, null, 2));

    files.set("tsconfig.json", JSON.stringify({
        compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            outDir: "./dist",
            rootDir: ".",
        },
        include: ["src/**/*", "tests/**/*"],
    }, null, 2));

    files.set(".env.example", getEnvExample(plan));
    files.set("src/index.ts", renderIndex(plan));
    files.set("src/config.ts", renderConfig(plan));
    files.set("src/mcp/server.ts", renderServer(plan));
    if (plan.runtime.transport !== "stdio") {
        files.set("src/mcp/access.ts", renderMcpAccess());
    }
    files.set("src/api/client.ts", renderClient());
    files.set("src/api/operations.ts", renderOperations(plan));
    files.set("src/api/serialization.ts", renderSerialization());
    files.set("mcpmint.manifest.json", JSON.stringify(manifest, null, 2));
    files.set("mcpmint.sbom.json", renderSbom(plan));
    files.set("mcpmint.provenance.json", renderProvenance(plan, manifest));
    files.set("mcpmint.dependencies.lock.json", renderDependencyLock(plan));
    files.set("THIRD_PARTY_LICENSES.md", renderLicenseSummary(plan));
    files.set(".github/dependabot.yml", renderDependabot(plan));
    const pin = runtimePin(plan);
    files.set(pin.name, pin.content);
    files.set("server.json", renderServerJson(plan));

    if (plan.features.documentation) {
        files.set("README.md", renderReadme(plan));
    }

    if (plan.features.docker) {
        files.set("Dockerfile", renderDockerfile(plan));
        files.set("docker-compose.yml", renderDockerCompose(plan));
        files.set(".dockerignore", "node_modules\ndist\n.env\n");
    }

    if (plan.features.tests) {
        files.set("tests/behavior.test.ts", renderNodeTest(plan));
    }

    return { manifest, files };
}
