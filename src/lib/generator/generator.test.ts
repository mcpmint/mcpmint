import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
import { buildOpenAPIModel } from "../api-model/openapi.ts";
import { buildPostmanApiModel } from "../api-model/postman.ts";
import { createPreviewResponse, type GeneratorRequest } from "./index.ts";

const openApiBaseApiModel = buildOpenAPIModel({
    openapi: "3.1.0",
    info: {
        title: "Billing API",
        version: "1.0.0",
        description: "Example OpenAPI fixture",
    },
    servers: [{ url: "https://api.example.com" }],
    paths: {
        "/customers": {
            post: {
                operationId: "create-customer",
                summary: "Create a customer",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    email: { type: "string", format: "email" },
                                    accountId: { type: "string" },
                                },
                                required: ["email"],
                            },
                        },
                    },
                },
                responses: { "201": { description: "Created" } },
            },
        },
    },
});

const openApiBase: Omit<GeneratorRequest, "exportConfig"> = {
    spec: {
        info: {
            title: "Billing API",
            version: "1.0.0",
            description: "Example OpenAPI fixture",
        },
        baseUrl: "https://api.example.com",
        apiModel: openApiBaseApiModel,
    },
    tools: [
        {
            endpointId: "POST-/customers",
            enabled: true,
            toolName: "create-customer",
            description: "Create a customer",
            parameters: [
                {
                    name: "email",
                    originalName: "email",
                    type: "string",
                    required: true,
                    description: "Customer email",
                    location: "body",
                    schema: { type: "string", format: "email" },
                },
                {
                    name: "account_id",
                    originalName: "accountId",
                    type: "string",
                    required: false,
                    description: "Optional account reference",
                    location: "body",
                    schema: { type: "string" },
                },
            ],
            bodySchema: {
                type: "object",
                properties: {
                    email: { type: "string", format: "email" },
                    accountId: { type: "string" },
                },
                required: ["email"],
            },
            bodyContentType: "application/json",
        },
    ],
    serverConfig: {
        name: "billing-mcp",
        version: "1.0.0",
        host: "localhost",
        port: 8080,
        transport: "http",
    },
    authConfig: {
        type: "apiKey",
        apiKey: { name: "x-api-key", in: "header" },
    },
};

const postmanBaseApiModel = buildPostmanApiModel({
    info: {
        name: "Postman Fixture",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        description: "Example Postman fixture",
        version: "1.0.0",
    },
    variable: [{ key: "baseUrl", value: "https://postman.example.com" }],
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
    item: [
        {
            name: "Fetch an order",
            request: {
                method: "GET",
                header: [{ key: "X-Trace-Id", value: "", description: "Trace header" }],
                url: {
                    raw: "{{baseUrl}}/orders/:orderId",
                    host: ["{{baseUrl}}"],
                    path: ["orders", ":orderId"],
                },
                description: "Fetch an order",
            },
        },
    ],
});

const postmanBase: Omit<GeneratorRequest, "exportConfig"> = {
    spec: {
        info: {
            title: "Postman Fixture",
            version: "1.0.0",
            description: "Example Postman fixture",
        },
        baseUrl: "https://postman.example.com",
        apiModel: postmanBaseApiModel,
    },
    tools: [
        {
            endpointId: "GET::/orders/{orderId}::0",
            enabled: true,
            toolName: "get-order",
            description: "Fetch an order",
            parameters: [
                {
                    name: "order_id",
                    originalName: "orderId",
                    type: "string",
                    required: true,
                    description: "Order id",
                    location: "path",
                },
                {
                    name: "x_trace_id",
                    originalName: "X-Trace-Id",
                    type: "string",
                    required: false,
                    description: "Trace header",
                    location: "header",
                },
            ],
        },
    ],
    serverConfig: {
        name: "orders-mcp",
        version: "2.1.0",
        host: "127.0.0.1",
        port: 9000,
        transport: "stdio",
    },
    authConfig: {
        type: "bearer",
    },
};

function getFileContent(preview: ReturnType<typeof createPreviewResponse>, fileName: string): string {
    const file = preview.files.find((entry) => entry.name === fileName);
    assert.ok(file, `Expected generated file ${fileName}`);
    return file.content;
}

type NodeSerializationHelpers = {
    serializePathParameter: (name: string, value: unknown, options: Record<string, unknown>) => string;
    appendSerializedParameter: (
        params: URLSearchParams,
        name: string,
        value: unknown,
        options: Record<string, unknown>
    ) => void;
};

type NodeAuthHelpers = {
    applyAuth: (
        params: URLSearchParams,
        headers: Record<string, string>,
        cookies: string[],
        requirements: Array<{ schemes: Record<string, unknown>[] }>
    ) => void;
};

type NodeMcpAccessHelpers = {
    isOriginAllowed: (origin: string | undefined, allowedOrigins: readonly string[]) => boolean;
    isBearerAuthorized: (authorization: string | undefined, token: string) => boolean;
};

function loadNodeSerializationHelpers(serializationFile: string): NodeSerializationHelpers {
    const output = ts.transpileModule(`${serializationFile}
(globalThis as any).__serializationHelpers = { serializePathParameter, appendSerializedParameter };`, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const context = {
        URLSearchParams,
        encodeURIComponent,
        exports: {},
    } as Record<string, unknown>;

    vm.runInNewContext(output, context);
    return context.__serializationHelpers as NodeSerializationHelpers;
}

function loadNodeAuthHelpers(clientFile: string): NodeAuthHelpers {
    const source = clientFile.replace('import { API_BASE_URL } from "../config.js";', 'const API_BASE_URL = "https://example.com";');
    const output = ts.transpileModule(`${source}
(globalThis as any).__authHelpers = { applyAuth };`, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const context = {
        URLSearchParams,
        Buffer,
        encodeURIComponent,
        exports: {},
    } as Record<string, unknown>;

    vm.runInNewContext(output, context);
    return context.__authHelpers as NodeAuthHelpers;
}

function loadNodeMcpAccessHelpers(accessFile: string): NodeMcpAccessHelpers {
    const source = accessFile.replace(
        'import { MCP_SERVER_ACCESS_CONFIG } from "../config.js";',
        'const MCP_SERVER_ACCESS_CONFIG = { allowedOrigins: ["https://client.example.com"], authToken: "secret" };'
    );
    const output = ts.transpileModule(`${source}
(globalThis as any).__mcpAccessHelpers = { isOriginAllowed, isBearerAuthorized };`, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const context = {
        exports: {},
        Buffer,
        URL,
        // Provide a require shim so the transpiled `require("node:crypto")` resolves
        // to the real implementation, exercising the constant-time comparison.
        require: (specifier: string) => {
            if (specifier === "node:crypto") {
                return { timingSafeEqual };
            }
            throw new Error(`Unexpected require in access helper vm: ${specifier}`);
        },
    } as Record<string, unknown>;

    vm.runInNewContext(output, context);
    return context.__mcpAccessHelpers as NodeMcpAccessHelpers;
}

type CompactMetaTool = {
    config: Record<string, unknown>;
    handler: (args: Record<string, unknown>, extra?: { signal: AbortSignal }) => Promise<{ structuredContent?: Record<string, unknown>; isError?: boolean }>;
};

type CompactServerHarness = {
    tools: Map<string, CompactMetaTool>;
    operationCalls: Array<{ index: number; args: Record<string, unknown> }>;
};

// Transpile and execute a compact-mode `src/mcp/server.ts` with mocked SDK,
// config, and operations modules so the three meta-tool handlers can be invoked
// directly. `operations` is a spy that records the flattened args it receives and
// returns canned JSON so invoke_api_endpoint's dispatch path can be exercised.
function loadNodeCompactServer(serverFile: string, operationCount: number): CompactServerHarness {
    const output = ts.transpileModule(`${serverFile}
(globalThis as any).__createServer = createServer;`, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;

    const operationCalls: Array<{ index: number; args: Record<string, unknown> }> = [];
    const operations = Array.from({ length: operationCount }, (_unused, index) =>
        async (args: Record<string, unknown>) => {
            operationCalls.push({ index, args });
            return JSON.stringify({ called: index, echo: args });
        }
    );

    const tools = new Map<string, CompactMetaTool>();
    class MockMcpServer {
        registerTool(name: string, config: Record<string, unknown>, handler: CompactMetaTool["handler"]) {
            tools.set(name, { config, handler: (args, extra = { signal: new AbortController().signal }) => handler(args, extra) });
        }
    }

    const context = {
        Buffer,
        Object,
        Number,
        JSON,
        Map,
        require: (specifier: string) => {
            if (specifier === "@modelcontextprotocol/sdk/server/mcp.js") return { McpServer: MockMcpServer };
            if (specifier === "zod") return { z: nodeRequire("zod").z };
            if (specifier === "../config.js") return { MCP_SERVER_CONFIG: { name: "compact-mcp", version: "1.0.0" } };
            if (specifier === "../api/operations.js") return { operations };
            throw new Error(`Unexpected require in compact server vm: ${specifier}`);
        },
        exports: {},
    } as Record<string, unknown>;

    vm.runInNewContext(output, context);
    (context.__createServer as () => void)();
    return { tools, operationCalls };
}

function nodeQueryString(
    helpers: NodeSerializationHelpers,
    name: string,
    value: unknown,
    options: Record<string, unknown>
): string {
    const params = new URLSearchParams();
    helpers.appendSerializedParameter(params, name, value, options);
    return params.toString();
}

function runPythonSerializationCases(serializationFile: string): Record<string, string> {
    const script = `${serializationFile}
import json

def query_string(name, value, options):
    from urllib.parse import urlencode
    params = []
    append_serialized_parameter(params, name, value, options)
    return urlencode(params)

print(json.dumps({
    "form_array_explode": query_string("tags", ["a", "b"], {"location": "query", "style": "form", "explode": True}),
    "form_object_explode": query_string("filter", {"role": "admin", "active": True}, {"location": "query", "style": "form", "explode": True}),
    "deep_object": query_string("filter", {"status": "open"}, {"location": "query", "style": "deepObject", "explode": True}),
    "space_delimited": query_string("tags", ["a", "b"], {"location": "query", "style": "spaceDelimited", "explode": False}),
    "pipe_delimited": query_string("tags", ["a", "b"], {"location": "query", "style": "pipeDelimited", "explode": False}),
    "simple_path": serialize_path_parameter("ids", ["a", "b"], {"location": "path", "style": "simple", "explode": False}),
    "label_path": serialize_path_parameter("ids", ["a", "b"], {"location": "path", "style": "label", "explode": True}),
    "matrix_path": serialize_path_parameter("ids", ["a", "b"], {"location": "path", "style": "matrix", "explode": False}),
    "matrix_path_explode": serialize_path_parameter("ids", ["a", "b"], {"location": "path", "style": "matrix", "explode": True}),
}))
`;

    return JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" })) as Record<string, string>;
}

function runPythonAuthCases(apiClientFile: string): Record<string, unknown> {
    const source = apiClientFile.replace(
        "import httpx\nfrom fastmcp.exceptions import ToolError\nfrom config import API_BASE_URL",
        `class _Client:
    def __init__(self, *args, **kwargs):
        pass


class _Httpx:
    Client = _Client


class ToolError(Exception):
    pass


httpx = _Httpx()
API_BASE_URL = "https://example.com"`
    );
    const script = `${source}
import json

def apply_case(requirements):
    params = []
    headers = {}
    cookies = {}
    apply_auth(params=params, headers=headers, cookies=cookies, auth_requirements=requirements)
    return {"params": params, "headers": headers, "cookies": cookies}

print(json.dumps({
    "optional": apply_case([
        {"schemes": []},
        {"schemes": [{"type": "bearer", "token": "secret"}]},
    ]),
    "partial_and": apply_case([
        {"schemes": [
            {"type": "apiKey", "in": "header", "name": "X-API-Key", "value": "key"},
            {"type": "bearer", "token": ""},
        ]},
    ]),
}))
`;

    return JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" })) as Record<string, unknown>;
}

test("openapi -> node preview matches golden contract", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: true,
                tests: true,
                verification: true,
            },
        },
    });

    assert.equal(preview.manifest.language, "node");
    assert.equal(preview.manifest.serverName, "billing-mcp");
    assert.equal(preview.manifest.features.docker, true);
    assert.equal(preview.verification?.status, "passed");
    assert.ok(preview.files.some((file) => file.name === "Dockerfile"));
    assert.ok(preview.files.some((file) => file.name === "tests/behavior.test.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/config.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/mcp/server.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/mcp/access.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/api/client.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/api/operations.ts"));
    assert.ok(preview.files.some((file) => file.name === "src/api/serialization.ts"));
    assert.ok(preview.files.some((file) => file.name === "mcpmint.sbom.json"));
    assert.ok(preview.files.some((file) => file.name === "mcpmint.provenance.json"));
    assert.ok(preview.files.some((file) => file.name === "mcpmint.dependencies.lock.json"));
    assert.ok(preview.files.some((file) => file.name === "THIRD_PARTY_LICENSES.md"));
    assert.ok(preview.files.some((file) => file.name === ".github/dependabot.yml"));
    assert.equal(getFileContent(preview, ".nvmrc"), "22.17.0\n");

    const sbom = JSON.parse(getFileContent(preview, "mcpmint.sbom.json")) as { bomFormat: string; components: Array<{ name: string; version: string }> };
    assert.equal(sbom.bomFormat, "CycloneDX");
    assert.ok(sbom.components.some((component) => component.name === "@modelcontextprotocol/sdk" && component.version === "1.29.0"));
    const provenance = JSON.parse(getFileContent(preview, "mcpmint.provenance.json")) as { buildDefinition: { externalParameters: { operationIds: string[] } } };
    assert.deepEqual(provenance.buildDefinition.externalParameters.operationIds, ["POST-/customers"]);

    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    const clientFile = getFileContent(preview, "src/api/client.ts");
    const configFile = getFileContent(preview, "src/config.ts");
    const operationsFile = getFileContent(preview, "src/api/operations.ts");
    const indexFile = getFileContent(preview, "src/index.ts");
    const readmeFile = getFileContent(preview, "README.md");
    const packageFile = getFileContent(preview, "package.json");
    assert.match(packageFile, /"@modelcontextprotocol\/sdk": "1\.29\.0"/);
    // Modern MCP registration API (registerTool with a config object) plus method-derived
    // annotations. POST -> not read-only, not idempotent, not destructive.
    assert.match(serverFile, /server\.registerTool\(\s*"create_customer",\s*\{/);
    assert.match(serverFile, /inputSchema: \{[\s\S]*"email": z\.string\(\)\.email\(\)/);
    assert.match(serverFile, /annotations: \{[\s\S]*readOnlyHint: false,[\s\S]*destructiveHint: false,[\s\S]*idempotentHint: false,[\s\S]*openWorldHint: true\n/);
    assert.match(configFile, /"apiKey:apiKeyHeader:header:x-api-key": \{ type: "apiKey", in: "header", name: "x-api-key", value: process\.env\.API_KEY \|\| "" \}/);
    assert.match(configFile, /MCP_SERVER_ACCESS_CONFIG/);
    assert.match(configFile, /authType: "none"/);
    assert.match(configFile, /authToken: ""/);
    assert.match(clientFile, /headers\[scheme\.name\] = scheme\.value/);
    assert.match(clientFile, /hasHeader\(headers, scheme\.name\)/);
    assert.match(operationsFile, /AUTH_SCHEMES\["apiKey:apiKeyHeader:header:x-api-key"\]/);
    assert.match(operationsFile, /"accountId": args\["account_id"\]/);
    assert.match(indexFile, /if \(req\.method !== "POST"\)/);
    assert.match(indexFile, /const server = createServer\(\);\n    const transport = new StreamableHTTPServerTransport\(\{ sessionIdGenerator: undefined \}\);/);
    assert.match(indexFile, /message: "Method not allowed\."/);
    assert.match(readmeFile, /## Install[\s\S]*npm install/);
    assert.match(readmeFile, /## Configure[\s\S]*cp \.env\.example \.env/);
    assert.match(readmeFile, /## Environment Variables[\s\S]*`API_BASE_URL`[\s\S]*`API_KEY`[\s\S]*`MCP_AUTH_TOKEN`[\s\S]*`MCP_ALLOWED_ORIGINS`/);
    assert.match(readmeFile, /## Run With Selected Transport[\s\S]*http:\/\/localhost:8080[\s\S]*npm run dev/);
    assert.match(readmeFile, /## Tools[\s\S]*`create_customer`: Create a customer/);
    assert.match(readmeFile, /## Upstream API Auth[\s\S]*`apiKey`: sends `x-api-key` via header from `API_KEY`/);
    assert.match(readmeFile, /## MCP Server Access[\s\S]*MCP server access auth protects the generated MCP endpoint itself/);
    assert.match(readmeFile, /## Known Warnings[\s\S]*- None\./);
    assert.match(readmeFile, /## Tested Runtime Versions[\s\S]*`@modelcontextprotocol\/sdk`[\s\S]*`1\.29\.0`/);
    assert.match(readmeFile, /## Example MCP Client Config[\s\S]*"url": "http:\/\/localhost:8080"/);
    assert.doesNotMatch(readmeFile, /## Example MCP Client Config[\s\S]*"env"/);
  });

test("node preview emits title, outputSchema, structuredContent, and read-only annotations for a GET with a response schema", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Users API", version: "1.0.0" },
        paths: {
            "/users/{userId}": {
                get: {
                    operationId: "getUser",
                    summary: "Get User",
                    parameters: [
                        { name: "userId", in: "path", required: true, schema: { type: "string" } },
                    ],
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            name: { type: "string" },
                                        },
                                        required: ["id"],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: { info: apiModel.info, baseUrl: "https://users.example.com", apiModel },
        tools: [{
            endpointId: "GET-/users/{userId}",
            enabled: true,
            toolName: "getUser",
            description: "Fetch a user by id",
            parameters: [],
        }],
        serverConfig: { name: "users-mcp", version: "1.0.0", host: "localhost", port: 8080, transport: "stdio" },
        authConfig: { type: "none" },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    // Title from the operation summary.
    assert.match(serverFile, /title: "Get User"/);
    // Structured output schema from the 200 response object schema (required carried through).
    assert.match(serverFile, /outputSchema: \{[\s\S]*"id": z\.string\(\)[\s\S]*"name": z\.string\(\)\.optional\(\)/);
    // GET -> read-only, idempotent, not destructive.
    assert.match(serverFile, /annotations: \{[\s\S]*title: "Get User",[\s\S]*readOnlyHint: true,[\s\S]*destructiveHint: false,[\s\S]*idempotentHint: true/);
    // Handler returns structuredContent alongside the text content.
    assert.match(serverFile, /\? parsed as Record<string, unknown>/);
    assert.match(serverFile, /content: \[\{ type: "text" as const, text \}\], structuredContent \}/);
});

test("node preview surfaces upstream failures as tool errors and emits a registry-ready server.json", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    // Runtime failures are returned as isError tool results, never thrown past the handler.
    assert.match(serverFile, /catch \(error\) \{[\s\S]*isError: true/);

    const serverJson = getFileContent(preview, "server.json");
    const parsed = JSON.parse(serverJson) as {
        $schema: string;
        name: string;
        version: string;
        packages: Array<{ registryType: string; identifier: string; version: string; runtimeHint: string; transport: { type: string } }>;
    };
    assert.equal(parsed.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    assert.match(parsed.name, /^io\.github\.OWNER\/billing-mcp$/);
    assert.equal(parsed.version, "1.0.0");
    assert.equal(parsed.packages[0].registryType, "npm");
    assert.equal(parsed.packages[0].identifier, "billing-mcp");
    assert.equal(parsed.packages[0].version, "1.0.0");
    assert.equal(parsed.packages[0].runtimeHint, "npx");
    // billing-mcp fixture uses http transport -> streamable-http in the registry entry.
    assert.equal(parsed.packages[0].transport.type, "streamable-http");
    // package.json carries the mcpName cross-check equal to the server.json name.
    const packageFile = getFileContent(preview, "package.json");
    assert.match(packageFile, /"mcpName": "io\.github\.OWNER\/billing-mcp"/);
});

test("README omits unverified cloud deploy buttons and explains hosting requirements", () => {
    const nodePreview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: { documentation: true, docker: false, tests: false, verification: true },
        },
    });
    const nodeReadme = getFileContent(nodePreview, "README.md");
    assert.match(nodeReadme, /## Hosting[\s\S]*Provider-specific adapters are not included/);
    assert.doesNotMatch(nodeReadme, /Deploy to Cloudflare|vercel\.com\/button|YOUR_TEMPLATE_ID/);

    const pythonPreview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: { documentation: true, docker: false, tests: false, verification: true },
        },
    });
    const pythonReadme = getFileContent(pythonPreview, "README.md");
    assert.match(pythonReadme, /## Hosting[\s\S]*Provider-specific adapters are not included/);
    assert.doesNotMatch(pythonReadme, /Deploy to Cloudflare/);
    assert.doesNotMatch(pythonReadme, /vercel\.com\/button/);
});

test("openapi -> python preview matches golden contract", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    assert.equal(preview.manifest.language, "python");
    assert.equal(preview.verification?.status, "passed");
    assert.ok(preview.files.some((file) => file.name === "tests/test_behavior.py"));
    assert.ok(preview.files.some((file) => file.name === "src/config.py"));
    assert.ok(preview.files.some((file) => file.name === "src/api_client.py"));
    assert.ok(preview.files.some((file) => file.name === "src/operations.py"));
    assert.ok(preview.files.some((file) => file.name === "src/serialization.py"));

    const pyprojectFile = getFileContent(preview, "pyproject.toml");
    const serverFile = getFileContent(preview, "src/server.py");
    const apiClientFile = getFileContent(preview, "src/api_client.py");
    const configFile = getFileContent(preview, "src/config.py");
    const operationsFile = getFileContent(preview, "src/operations.py");
    const readmeFile = getFileContent(preview, "README.md");
    assert.match(pyprojectFile, /"fastmcp==3\.4\.2"/);
    // Modern FastMCP registration: name plus method-derived ToolAnnotations.
    // POST -> not read-only, not idempotent, not destructive; open-world.
    assert.match(serverFile, /FunctionTool\.from_function\(create_customer, name="create_customer", annotations=ToolAnnotations\(title="Create a customer", readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True\)\)/);
    assert.match(serverFile, /from mcp\.types import ToolAnnotations/);
    assert.match(serverFile, /logging\.basicConfig\(level=logging\.INFO, stream=sys\.stderr\)/);
    assert.match(configFile, /"apiKey:apiKeyHeader:header:x-api-key": \{"type": "apiKey", "in": "header", "name": "x-api-key", "value": os\.getenv\("API_KEY", ""\)\}/);
    assert.match(apiClientFile, /headers\[name\] = str\(scheme\["value"\]\)/);
    assert.match(apiClientFile, /has_header\(headers, name\)/);
    assert.match(operationsFile, /AUTH_SCHEMES\["apiKey:apiKeyHeader:header:x-api-key"\]/);
    assert.match(operationsFile, /json_body\["accountId"\] = account_id/);
    assert.match(readmeFile, /## Install[\s\S]*pip install -e \./);
    assert.match(readmeFile, /## Configure[\s\S]*cp \.env\.example \.env/);
    assert.match(readmeFile, /## Environment Variables[\s\S]*`API_BASE_URL`[\s\S]*`API_KEY`[\s\S]*`MCP_AUTH_TOKEN`[\s\S]*`MCP_ALLOWED_ORIGINS`/);
    assert.match(readmeFile, /## Run With Selected Transport[\s\S]*http:\/\/localhost:8080[\s\S]*python src\/server\.py/);
    assert.match(readmeFile, /## Tools[\s\S]*`create_customer`: Create a customer/);
    assert.match(readmeFile, /## Upstream API Auth[\s\S]*`apiKey`: sends `x-api-key` via header from `API_KEY`/);
    assert.match(readmeFile, /## MCP Server Access[\s\S]*Generated Python FastMCP output enforces MCP server access in `src\/access\.py`/);
    assert.match(readmeFile, /## Known Warnings[\s\S]*- None\./);
    assert.match(readmeFile, /## Tested Runtime Versions[\s\S]*`fastmcp`[\s\S]*`3\.4\.2`/);
    assert.match(readmeFile, /## Example MCP Client Config[\s\S]*"url": "http:\/\/localhost:8080\/mcp"/);
    assert.doesNotMatch(readmeFile, /## Example MCP Client Config[\s\S]*"env"/);
});

test("python output escapes carriage returns from CRLF spec text", () => {
    // CRLF line endings are common in real-world spec descriptions. A raw \r
    // inside a single-line "..." literal is a Python SyntaxError, so every
    // string routed through toPythonStringLiteral must escape it.
    const crlfDescription = "Create a customer.\r\nReturns the new customer.";
    const preview = createPreviewResponse({
        ...openApiBase,
        tools: [
            {
                ...openApiBase.tools[0],
                description: crlfDescription,
            },
        ],
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    const pythonFiles = preview.files.filter((file) => file.name.endsWith(".py"));
    assert.ok(pythonFiles.length > 0, "Expected generated Python files");
    for (const file of pythonFiles) {
        assert.ok(!file.content.includes("\r"), `${file.name} contains a raw carriage return`);
    }

    const serverFile = getFileContent(preview, "src/server.py");
    assert.match(serverFile, /Create a customer\.\\r\\nReturns the new customer\./);

    // The emitted source must actually parse: py_compile every generated module.
    const tempDir = mkdtempSync(join(tmpdir(), "mcpmint-crlf-"));
    try {
        for (const file of pythonFiles) {
            const target = join(tempDir, file.name);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, file.content);
            execFileSync("python3", ["-m", "py_compile", target]);
        }
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("python preview emits title, output_schema, structured content, and read-only annotations for a GET with a response schema", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Users API", version: "1.0.0" },
        paths: {
            "/users/{userId}": {
                get: {
                    operationId: "getUser",
                    summary: "Get User",
                    parameters: [
                        { name: "userId", in: "path", required: true, schema: { type: "string" } },
                    ],
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            name: { type: "string" },
                                        },
                                        required: ["id"],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: { info: apiModel.info, baseUrl: "https://users.example.com", apiModel },
        tools: [{
            endpointId: "GET-/users/{userId}",
            enabled: true,
            toolName: "getUser",
            description: "Fetch a user by id",
            parameters: [],
        }],
        serverConfig: { name: "users-mcp", version: "1.0.0", host: "localhost", port: 8080, transport: "stdio" },
        authConfig: { type: "none" },
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const serverFile = getFileContent(preview, "src/server.py");
    // Title from the operation summary, carried on ToolAnnotations.
    assert.match(serverFile, /ToolAnnotations\(title="Get User", readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=True\)/);
    // Structured output schema derived from the 200 response object schema, emitted as
    // FastMCP's output_schema= (a JSON Schema dict, required carried through).
    assert.match(serverFile, /output_schema=\{"type": "object", "properties": \{"id": \{"type": "string"\}, "name": \{"type": "string"\}\}, "required": \["id"\]\}/);
    // Object schema is returned directly (no result-wrapping); FastMCP builds structured content from the dict.
    assert.match(serverFile, /return getUser_operation\(userId\)/);
});

test("python preview wraps non-object output schemas under result", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Count API", version: "1.0.0" },
        paths: {
            "/count": {
                get: {
                    operationId: "getCount",
                    responses: {
                        "200": {
                            description: "OK",
                            content: { "application/json": { schema: { type: "array", items: { type: "string" } } } },
                        },
                    },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: { info: apiModel.info, baseUrl: "https://count.example.com", apiModel },
        tools: [{ endpointId: "GET-/count", enabled: true, toolName: "getCount", description: "Get count", parameters: [] }],
        serverConfig: { name: "count-mcp", version: "1.0.0", host: "localhost", port: 8080, transport: "stdio" },
        authConfig: { type: "none" },
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const serverFile = getFileContent(preview, "src/server.py");
    // Array (non-object) schema is wrapped under `result` in both the schema and the return value.
    assert.match(serverFile, /output_schema=\{"type": "object", "properties": \{"result": \{"type": "array"[\s\S]*"required": \["result"\]\}/);
    assert.match(serverFile, /return \{"result": getCount_operation\(\)\}/);
});

test("python preview surfaces upstream failures as ToolError and emits a registry-ready pypi server.json", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const apiClientFile = getFileContent(preview, "src/api_client.py");
    // Upstream HTTP failures raise ToolError (an isError tool result) rather than a raw exception.
    assert.match(apiClientFile, /from fastmcp\.exceptions import ToolError/);
    assert.match(apiClientFile, /if response\.status_code >= 400:\s*\n\s*raise ToolError\(f"Upstream returned HTTP \{response\.status_code\}\."\)/);

    const serverJson = getFileContent(preview, "server.json");
    const parsed = JSON.parse(serverJson) as {
        $schema: string;
        name: string;
        version: string;
        packages: Array<{ registryType: string; registryBaseUrl: string; identifier: string; version: string; runtimeHint: string; transport: { type: string } }>;
    };
    assert.equal(parsed.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    assert.match(parsed.name, /^io\.github\.OWNER\/billing-mcp$/);
    assert.equal(parsed.version, "1.0.0");
    assert.equal(parsed.packages[0].registryType, "pypi");
    assert.equal(parsed.packages[0].registryBaseUrl, "https://pypi.org");
    assert.equal(parsed.packages[0].identifier, "billing-mcp");
    assert.equal(parsed.packages[0].version, "1.0.0");
    assert.equal(parsed.packages[0].runtimeHint, "uvx");
    // billing-mcp fixture uses http transport -> streamable-http in the registry entry.
    assert.equal(parsed.packages[0].transport.type, "streamable-http");
    // pyproject carries the mcpName cross-check equal to the server.json name.
    const pyprojectFile = getFileContent(preview, "pyproject.toml");
    assert.match(pyprojectFile, /\[tool\.mcp\]\nname = "io\.github\.OWNER\/billing-mcp"/);
});

test("python Dockerfile is a non-root multi-stage build supporting stdio and HTTP", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: { documentation: false, docker: true, tests: false, verification: true },
        },
    });

    const dockerfile = getFileContent(preview, "Dockerfile");
    assert.match(dockerfile, /FROM python:3\.11\.13-slim-bookworm AS build/);
    assert.match(dockerfile, /FROM python:3\.11\.13-slim-bookworm AS runtime/);
    assert.match(dockerfile, /useradd --system --gid app/);
    assert.match(dockerfile, /USER app/);
    // billing-mcp fixture is http transport.
    assert.match(dockerfile, /MCP_HOST=0\.0\.0\.0/);
    assert.match(dockerfile, /ENTRYPOINT \["python", "src\/server\.py"\]/);
});

test("node HTTP/SSE output emits MCP server access enforcement separately from upstream auth", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        mcpServerAuthConfig: {
            type: "bearer",
            allowedOrigins: ["https://client.example.com"],
        },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    assert.deepEqual(preview.validation.warnings, []);

    const envFile = getFileContent(preview, ".env.example");
    const indexFile = getFileContent(preview, "src/index.ts");
    const accessFile = getFileContent(preview, "src/mcp/access.ts");
    const readmeFile = getFileContent(preview, "README.md");
    const testFile = getFileContent(preview, "tests/behavior.test.ts");
    const helpers = loadNodeMcpAccessHelpers(accessFile);

    assert.match(envFile, /^MCP_AUTH_TOKEN=$/m);
    assert.match(envFile, /MCP_ALLOWED_ORIGINS=https:\/\/client\.example\.com/);
    assert.match(indexFile, /authorizeMcpRequest\(req, res\)/);
    assert.match(indexFile, /assertMcpServerAccessConfig\(\)/);
    assert.match(accessFile, /MCP_SERVER_ACCESS_CONFIG\.authType === "bearer"[\s\S]*if \(!MCP_SERVER_ACCESS_CONFIG\.authToken\)/);
    assert.match(accessFile, /handleMcpPreflight/);
    assert.match(accessFile, /res\.writeHead\(403/);
    assert.match(accessFile, /res\.writeHead\(401/);
    assert.match(accessFile, /res\.writeHead\(500/);
    assert.match(testFile, /MCP server access helpers enforce bearer tokens and allowed origins/);
    assert.match(readmeFile, /## Upstream API Auth[\s\S]*## MCP Server Access/);
    assert.match(readmeFile, /HTTP\/SSE requests must include `Authorization: Bearer <token>`/);
    assert.equal(helpers.isOriginAllowed("https://client.example.com", ["https://client.example.com"]), true);
    assert.equal(helpers.isOriginAllowed("https://evil.example.com", ["https://client.example.com"]), false);
    assert.equal(helpers.isBearerAuthorized("Bearer secret", "secret"), true);
    assert.equal(helpers.isBearerAuthorized("Bearer nope", "secret"), false);
});

test("python HTTP/SSE output enforces MCP server bearer auth and Origin validation", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        mcpServerAuthConfig: {
            type: "bearer",
            allowedOrigins: ["https://client.example.com"],
        },
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    assert.deepEqual(preview.validation.warnings, []);

    const envFile = getFileContent(preview, ".env.example");
    const configFile = getFileContent(preview, "src/config.py");
    const serverFile = getFileContent(preview, "src/server.py");
    const accessFile = getFileContent(preview, "src/access.py");
    const readmeFile = getFileContent(preview, "README.md");

    assert.match(envFile, /^MCP_AUTH_TOKEN=$/m);
    assert.match(envFile, /MCP_ALLOWED_ORIGINS=https:\/\/client\.example\.com/);
    assert.match(configFile, /"auth_type": "bearer"/);

    // The FastMCP ASGI app is built with the access-control middleware and the
    // startup assertion runs before serving.
    assert.match(serverFile, /from access import assert_mcp_server_access_config, build_mcp_access_middleware/);
    assert.match(serverFile, /assert_mcp_server_access_config\(\)/);
    assert.match(serverFile, /middleware=build_mcp_access_middleware\(\)/);

    // access.py enforces deny-by-default Origin policy and constant-time bearer auth.
    assert.match(accessFile, /class McpAccessMiddleware/);
    assert.match(accessFile, /def is_origin_allowed/);
    assert.match(accessFile, /def is_bearer_authorized/);
    assert.match(accessFile, /hmac\.compare_digest/);
    assert.match(accessFile, /return _is_localhost_origin\(origin\)/);
    assert.match(accessFile, /403, "Origin not allowed"/);
    assert.match(accessFile, /"Missing or invalid bearer token"/);
    assert.match(accessFile, /raise RuntimeError\(/);

    // README documents the enforcement (no reverse-proxy / placeholder language).
    assert.match(readmeFile, /\| `MCP_AUTH_TOKEN` \|[^\n]*Required; set to a long random value/);
    assert.match(readmeFile, /Generated Python FastMCP output enforces MCP server access in `src\/access\.py`/);
    assert.doesNotMatch(readmeFile, /Placeholder only; generated FastMCP code does not enforce it/);
    assert.doesNotMatch(readmeFile, /does not enforce them because the emitted FastMCP server/);
});

test("generated MCP access config fails closed for bearer auth and blank origin overrides", () => {
    const preview = createPreviewResponse({
        ...openApiBase,
        mcpServerAuthConfig: {
            type: "bearer",
            allowedOrigins: ["https://client.example.com"],
        },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const configFile = getFileContent(preview, "src/config.ts");
    const accessFile = getFileContent(preview, "src/mcp/access.ts");

    assert.match(configFile, /if \(value === undefined \|\| value\.trim\(\) === ""\) return \[\.\.\.fallback\]/);
    assert.match(configFile, /throw new Error\("MCP_AUTH_TOKEN is required when MCP server bearer auth is enabled\."\)/);
    assert.match(configFile, /authType: "bearer"/);
    assert.match(configFile, /authToken: process\.env\.MCP_AUTH_TOKEN \|\| ""/);
    assert.match(accessFile, /MCP_SERVER_ACCESS_CONFIG\.authType === "bearer"[\s\S]*if \(!MCP_SERVER_ACCESS_CONFIG\.authToken\)/);
});

test("node preview keeps complex json bodies as a single body argument", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Profiles API", version: "1.0.0" },
        paths: {
            "/profiles": {
                post: {
                    operationId: "createProfile",
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        profile: {
                                            type: "object",
                                            properties: { city: { type: "string" } },
                                        },
                                    },
                                    required: ["name", "profile"],
                                },
                            },
                        },
                    },
                    responses: { "201": { description: "Created" } },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: {
            info: apiModel.info,
            baseUrl: "https://profiles.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "POST-/profiles",
            enabled: true,
            toolName: "createProfile",
            description: "Create profile",
            parameters: [],
        }],
        serverConfig: {
            name: "profiles-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });

    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    const operationsFile = getFileContent(preview, "src/api/operations.ts");
    assert.match(serverFile, /"body": z\.object/);
    assert.match(operationsFile, /body: JSON\.stringify\(args\["body"\]\)/);
    assert.doesNotMatch(operationsFile, /"profile": args\["profile"\]/);
});

test("postman -> node preview preserves path and headers", () => {
    const preview = createPreviewResponse({
        ...postmanBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "pnpm",
            features: {
                documentation: true,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });

    assert.equal(preview.manifest.language, "node");
    const clientFile = getFileContent(preview, "src/api/client.ts");
    const configFile = getFileContent(preview, "src/config.ts");
    const operationsFile = getFileContent(preview, "src/api/operations.ts");
    const readmeFile = getFileContent(preview, "README.md");
    assert.match(configFile, /"bearer:bearer::": \{ type: "bearer", token: process\.env\.BEARER_TOKEN \|\| "" \}/);
    assert.match(clientFile, /headers\["Authorization"\] = `Bearer \$\{scheme\.token\}`/);
    assert.match(operationsFile, /AUTH_SCHEMES\["bearer:bearer::"\]/);
    assert.match(operationsFile, /path = path\.replace\("\{orderId\}", serializePathParameter\("orderId", args\["order_id"\]/);
    assert.match(operationsFile, /requestHeaders\["X-Trace-Id"\] = serializeParameterValue\("X-Trace-Id", args\["x_trace_id"\]/);
    assert.match(readmeFile, /## Example MCP Client Config[\s\S]*"command": "node"/);
    assert.match(readmeFile, /\/absolute\/path\/to\/orders-mcp\/dist\/src\/index\.js/);
    assert.doesNotMatch(readmeFile, /"args": \[\s*"dist\/src\/index\.js"/);
    assert.match(readmeFile, /## Example MCP Client Config[\s\S]*"env":/);
    assert.match(readmeFile, /## Example MCP Client Config[\s\S]*"BEARER_TOKEN": "your_token_here"/);
});

test("postman -> python preview preserves tool name and stdio transport", () => {
    const preview = createPreviewResponse({
        ...postmanBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    assert.equal(preview.manifest.language, "python");
    assert.equal(preview.manifest.features.documentation, false);
    const serverFile = getFileContent(preview, "src/server.py");
    const apiClientFile = getFileContent(preview, "src/api_client.py");
    const configFile = getFileContent(preview, "src/config.py");
    const operationsFile = getFileContent(preview, "src/operations.py");
    // GET -> read-only, idempotent, not destructive; open-world.
    assert.match(serverFile, /FunctionTool\.from_function\(get_order, name="get_order", annotations=ToolAnnotations\(title="Fetch an order", readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=True\)\)/);
    assert.match(serverFile, /mcp\.run\(transport="stdio"\)/);
    assert.match(configFile, /"bearer:bearer::": \{"type": "bearer", "token": os\.getenv\("BEARER_TOKEN", ""\)\}/);
    assert.match(apiClientFile, /headers\["Authorization"\] = f"Bearer \{scheme\['token'\]\}"/);
    assert.match(operationsFile, /AUTH_SCHEMES\["bearer:bearer::"\]/);
    assert.match(operationsFile, /path = path\.replace\("\{orderId\}", serialize_path_parameter\("orderId", order_id/);
});

test("previews serialize OpenAPI path, query, header, and cookie parameters with style metadata", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Search API", version: "1.0.0" },
        paths: {
            "/reports/{ids}": {
                get: {
                    operationId: "searchReports",
                    parameters: [
                        {
                            name: "ids",
                            in: "path",
                            required: true,
                            style: "simple",
                            explode: false,
                            schema: { type: "array", items: { type: "string" } },
                        },
                        {
                            name: "filter",
                            in: "query",
                            style: "deepObject",
                            explode: true,
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "string" },
                                    owner: { type: "string" },
                                },
                            },
                        },
                        {
                            name: "tags",
                            in: "query",
                            style: "pipeDelimited",
                            explode: false,
                            schema: { type: "array", items: { type: "string" } },
                        },
                        {
                            name: "X-Fields",
                            in: "header",
                            style: "simple",
                            explode: false,
                            schema: { type: "array", items: { type: "string" } },
                        },
                        {
                            name: "prefs",
                            in: "cookie",
                            style: "form",
                            explode: false,
                            schema: {
                                type: "object",
                                properties: {
                                    theme: { type: "string" },
                                },
                            },
                        },
                    ],
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });
    const baseRequest: Omit<GeneratorRequest, "exportConfig"> = {
        spec: {
            info: apiModel.info,
            baseUrl: "https://search.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "GET-/reports/{ids}",
            enabled: true,
            toolName: "searchReports",
            description: "Search reports",
            parameters: [],
        }],
        serverConfig: {
            name: "search-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
    };

    const nodePreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const nodeOperations = getFileContent(nodePreview, "src/api/operations.ts");
    assert.match(nodeOperations, /serializePathParameter\("ids", args\["ids"\], \{ location: "path", style: "simple", explode: false \}\)/);
    assert.match(nodeOperations, /appendSerializedParameter\(queryString, "filter", args\["filter"\], \{ location: "query", style: "deepObject", explode: true \}\)/);
    assert.match(nodeOperations, /appendSerializedParameter\(queryString, "tags", args\["tags"\], \{ location: "query", style: "pipeDelimited", explode: false \}\)/);
    assert.match(nodeOperations, /requestHeaders\["X-Fields"\] = serializeParameterValue\("X-Fields", args\["X_Fields"\], \{ location: "header", style: "simple", explode: false \}\)/);
    assert.match(nodeOperations, /cookiePairs\.push\(`prefs=\$\{encodeURIComponent\(serializeParameterValue\("prefs", args\["prefs"\], \{ location: "cookie", style: "form", explode: false \}\)\)\}`\)/);

    const pythonPreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const operationsFile = getFileContent(pythonPreview, "src/operations.py");
    assert.match(operationsFile, /serialize_path_parameter\("ids", ids, \{ "location": "path", "style": "simple", "explode": False \}\)/);
    assert.match(operationsFile, /append_serialized_parameter\(params, "filter", filter, \{ "location": "query", "style": "deepObject", "explode": True \}\)/);
    assert.match(operationsFile, /append_serialized_parameter\(params, "tags", tags, \{ "location": "query", "style": "pipeDelimited", "explode": False \}\)/);
    assert.match(operationsFile, /request_headers\["X-Fields"\] = serialize_parameter_value\("X-Fields", X_Fields, \{ "location": "header", "style": "simple", "explode": False \}\)/);
    assert.match(operationsFile, /cookies\["prefs"\] = serialize_parameter_value\("prefs", prefs, \{ "location": "cookie", "style": "form", "explode": False \}\)/);
});

test("node preview emits per-operation auth requirements and skips duplicate auth headers", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Auth API", version: "1.0.0" },
        components: {
            securitySchemes: {
                bearerAuth: { type: "http", scheme: "bearer" },
                basicAuth: { type: "http", scheme: "basic" },
                headerKey: { type: "apiKey", in: "header", name: "X-API-Key" },
                queryKey: { type: "apiKey", in: "query", name: "api_key" },
                cookieKey: { type: "apiKey", in: "cookie", name: "session" },
            },
        },
        security: [{ bearerAuth: [] }],
        paths: {
            "/global": {
                get: {
                    operationId: "globalAuth",
                    responses: { "200": { description: "OK" } },
                },
            },
            "/operation": {
                get: {
                    operationId: "operationAuth",
                    security: [{ queryKey: [] }],
                    responses: { "200": { description: "OK" } },
                },
            },
            "/public": {
                get: {
                    operationId: "publicOperation",
                    security: [],
                    responses: { "200": { description: "OK" } },
                },
            },
            "/alternatives": {
                get: {
                    operationId: "alternativeAuth",
                    security: [{ cookieKey: [] }, { basicAuth: [] }],
                    responses: { "200": { description: "OK" } },
                },
            },
            "/duplicate": {
                get: {
                    operationId: "duplicateHeaderAuth",
                    security: [{ headerKey: [] }],
                    parameters: [
                        { name: "X-API-Key", in: "header", schema: { type: "string" } },
                    ],
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: {
            info: apiModel.info,
            baseUrl: "https://auth.example.com",
            apiModel,
        },
        tools: apiModel.operations.map((operation) => ({
            endpointId: operation.id,
            enabled: true,
            toolName: operation.operationId || operation.id,
            description: operation.summary || operation.id,
            parameters: [],
        })),
        serverConfig: {
            name: "auth-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });

    const configFile = getFileContent(preview, "src/config.ts");
    const clientFile = getFileContent(preview, "src/api/client.ts");
    const operationsFile = getFileContent(preview, "src/api/operations.ts");

    assert.match(configFile, /BEARER_AUTH_TOKEN/);
    assert.match(configFile, /QUERY_KEY_API_KEY/);
    assert.match(configFile, /COOKIE_KEY_API_KEY/);
    assert.match(configFile, /BASIC_AUTH_USERNAME/);
    assert.match(clientFile, /queryString\.has\(scheme\.name\)/);
    assert.match(clientFile, /hasCookie\(cookiePairs, scheme\.name\)/);
    assert.match(clientFile, /hasHeader\(headers, scheme\.name\)/);
    assert.match(operationsFile, /AUTH_SCHEMES\["bearerAuth:bearer::"\]/);
    assert.match(operationsFile, /AUTH_SCHEMES\["queryKey:apiKeyQuery:query:api_key"\]/);
    assert.match(operationsFile, /applyAuth\(queryString, requestHeaders, cookiePairs, \[\]\)/);
    assert.match(operationsFile, /AUTH_SCHEMES\["cookieKey:apiKeyCookie:cookie:session"\]/);
    assert.match(operationsFile, /AUTH_SCHEMES\["basicAuth:basic::"\]/);
    assert.match(operationsFile, /requestHeaders\["X-API-Key"\] = serializeParameterValue\("X-API-Key", args\["X_API_Key"\]/);
    assert.match(operationsFile, /AUTH_SCHEMES\["headerKey:apiKeyHeader:header:X-API-Key"\]/);
});

test("generated auth helpers treat anonymous alternatives as no-op and do not partially apply AND auth", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Runtime Auth API", version: "1.0.0" },
        components: {
            securitySchemes: {
                bearerAuth: { type: "http", scheme: "bearer" },
            },
        },
        paths: {
            "/optional": {
                get: {
                    operationId: "optionalAuth",
                    security: [{}, { bearerAuth: [] }],
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });
    const baseRequest: Omit<GeneratorRequest, "exportConfig"> = {
        spec: {
            info: apiModel.info,
            baseUrl: "https://auth.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "GET-/optional",
            enabled: true,
            toolName: "optionalAuth",
            description: "Optional auth",
            parameters: [],
        }],
        serverConfig: {
            name: "runtime-auth-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
    };

    const nodePreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const nodeAuth = loadNodeAuthHelpers(getFileContent(nodePreview, "src/api/client.ts"));
    const optionalQuery = new URLSearchParams();
    const optionalHeaders: Record<string, string> = {};
    const optionalCookies: string[] = [];
    nodeAuth.applyAuth(optionalQuery, optionalHeaders, optionalCookies, [
        { schemes: [] },
        { schemes: [{ type: "bearer", token: "secret" }] },
    ]);
    assert.equal(optionalQuery.toString(), "");
    assert.deepEqual(optionalHeaders, {});
    assert.deepEqual(optionalCookies, []);

    const partialQuery = new URLSearchParams();
    const partialHeaders: Record<string, string> = {};
    const partialCookies: string[] = [];
    nodeAuth.applyAuth(partialQuery, partialHeaders, partialCookies, [{
        schemes: [
            { type: "apiKey", in: "header", name: "X-API-Key", value: "key" },
            { type: "bearer", token: "" },
        ],
    }]);
    assert.equal(partialQuery.toString(), "");
    assert.deepEqual(partialHeaders, {});
    assert.deepEqual(partialCookies, []);

    const pythonPreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const pythonCases = runPythonAuthCases(getFileContent(pythonPreview, "src/api_client.py"));
    assert.deepEqual(pythonCases, {
        optional: { params: [], headers: {}, cookies: {} },
        partial_and: { params: [], headers: {}, cookies: {} },
    });
});

test("generated serialization helpers produce golden OpenAPI array and object encodings", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Serialization API", version: "1.0.0" },
        paths: {
            "/reports/{ids}": {
                get: {
                    operationId: "serializeReports",
                    parameters: [
                        {
                            name: "ids",
                            in: "path",
                            required: true,
                            style: "simple",
                            explode: false,
                            schema: { type: "array", items: { type: "string" } },
                        },
                        {
                            name: "tags",
                            in: "query",
                            style: "form",
                            explode: true,
                            schema: { type: "array", items: { type: "string" } },
                        },
                    ],
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });
    const baseRequest: Omit<GeneratorRequest, "exportConfig"> = {
        spec: {
            info: apiModel.info,
            baseUrl: "https://serialization.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "GET-/reports/{ids}",
            enabled: true,
            toolName: "serializeReports",
            description: "Serialize reports",
            parameters: [],
        }],
        serverConfig: {
            name: "serialization-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
    };

    const nodePreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const nodeHelpers = loadNodeSerializationHelpers(getFileContent(nodePreview, "src/api/serialization.ts"));
    assert.equal(nodeQueryString(nodeHelpers, "tags", ["a", "b"], { location: "query", style: "form", explode: true }), "tags=a&tags=b");
    assert.equal(nodeQueryString(nodeHelpers, "filter", { role: "admin", active: true }, { location: "query", style: "form", explode: true }), "role=admin&active=true");
    assert.equal(nodeQueryString(nodeHelpers, "filter", { status: "open" }, { location: "query", style: "deepObject", explode: true }), "filter%5Bstatus%5D=open");
    assert.equal(nodeQueryString(nodeHelpers, "tags", ["a", "b"], { location: "query", style: "spaceDelimited", explode: false }), "tags=a+b");
    assert.equal(nodeQueryString(nodeHelpers, "tags", ["a", "b"], { location: "query", style: "pipeDelimited", explode: false }), "tags=a%7Cb");
    assert.equal(nodeHelpers.serializePathParameter("ids", ["a", "b"], { location: "path", style: "simple", explode: false }), "a,b");
    assert.equal(nodeHelpers.serializePathParameter("ids", ["a", "b"], { location: "path", style: "label", explode: true }), ".a.b");
    assert.equal(nodeHelpers.serializePathParameter("ids", ["a", "b"], { location: "path", style: "matrix", explode: false }), ";ids=a,b");
    assert.equal(nodeHelpers.serializePathParameter("ids", ["a", "b"], { location: "path", style: "matrix", explode: true }), ";ids=a;ids=b");

    const pythonPreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const pythonCases = runPythonSerializationCases(getFileContent(pythonPreview, "src/serialization.py"));
    assert.deepEqual(pythonCases, {
        form_array_explode: "tags=a&tags=b",
        form_object_explode: "role=admin&active=true",
        deep_object: "filter%5Bstatus%5D=open",
        space_delimited: "tags=a+b",
        pipe_delimited: "tags=a%7Cb",
        simple_path: "a,b",
        label_path: ".a.b",
        matrix_path: ";ids=a,b",
        matrix_path_explode: ";ids=a;ids=b",
    });
});

test("node preview preserves cookie params and form encoded bodies", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Forms API", version: "1.0.0" },
        servers: [{ url: "https://forms.example.com" }],
        paths: {
            "/sessions": {
                post: {
                    operationId: "create-session",
                    summary: "Create a session",
                    parameters: [
                        { name: "sessionId", in: "cookie", required: false, description: "Session cookie", schema: { type: "string" } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            "application/x-www-form-urlencoded": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        username: { type: "string" },
                                        password: { type: "string" },
                                    },
                                    required: ["username", "password"],
                                },
                            },
                        },
                    },
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });
    const preview = createPreviewResponse({
        spec: {
            info: {
                title: "Forms API",
                version: "1.0.0",
            },
            baseUrl: "https://forms.example.com",
            apiModel,
        },
        tools: [
            {
                endpointId: "POST-/sessions",
                enabled: true,
                toolName: "create-session",
                description: "Create a session",
                parameters: [
                    {
                        name: "session_id",
                        originalName: "sessionId",
                        type: "string",
                        required: false,
                        description: "Session cookie",
                        location: "cookie",
                    },
                    {
                        name: "username",
                        originalName: "username",
                        type: "string",
                        required: true,
                        description: "User name",
                        location: "body",
                    },
                    {
                        name: "password",
                        originalName: "password",
                        type: "string",
                        required: true,
                        description: "Password",
                        location: "body",
                    },
                ],
                bodySchema: {
                    type: "object",
                    properties: {
                        username: { type: "string" },
                        password: { type: "string" },
                    },
                    required: ["username", "password"],
                },
                bodyContentType: "application/x-www-form-urlencoded",
            },
        ],
        serverConfig: {
            name: "forms-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "http",
        },
        authConfig: {
            type: "none",
        },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: true,
                verification: true,
            },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const operationsFile = getFileContent(preview, "src/api/operations.ts");
    assert.match(operationsFile, /const formBody = new URLSearchParams\(\);/);
    assert.match(operationsFile, /requestHeaders\["Content-Type"\] = "application\/x-www-form-urlencoded"/);
    assert.match(operationsFile, /cookiePairs\.push\(`sessionId=/);
});

test("previews render multipart binary fields as file uploads", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Assets API", version: "1.0.0" },
        paths: {
            "/assets": {
                post: {
                    operationId: "uploadAsset",
                    requestBody: {
                        required: true,
                        content: {
                            "multipart/form-data": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        file: { type: "string", format: "binary" },
                                        label: { type: "string" },
                                    },
                                    required: ["file"],
                                },
                            },
                        },
                    },
                    responses: { "201": { description: "Uploaded" } },
                },
            },
        },
    });
    const baseRequest: Omit<GeneratorRequest, "exportConfig"> = {
        spec: {
            info: apiModel.info,
            baseUrl: "https://assets.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "POST-/assets",
            enabled: true,
            toolName: "uploadAsset",
            description: "Upload asset",
            parameters: [],
        }],
        serverConfig: {
            name: "assets-mcp",
            version: "1.0.0",
            host: "localhost",
            port: 8080,
            transport: "stdio",
        },
        authConfig: { type: "none" },
    };

    const nodePreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const nodeServer = getFileContent(nodePreview, "src/mcp/server.ts");
    const nodeOperations = getFileContent(nodePreview, "src/api/operations.ts");
    assert.match(nodeServer, /"file": z\.string\(\)\.describe\("Base64-encoded file content\."\)/);
    assert.match(nodeOperations, /const fileBytes = Buffer\.from\(String\(args\["file"\]\), "base64"\);/);
    assert.match(nodeOperations, /formBody\.append\("file", new Blob\(\[fileBytes\]\), "file"\);/);
    assert.match(nodeOperations, /formBody\.append\("label", String\(args\["label"\]\)\);/);

    const pythonPreview = createPreviewResponse({
        ...baseRequest,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            features: {
                documentation: false,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });
    const operationsFile = getFileContent(pythonPreview, "src/operations.py");
    assert.match(operationsFile, /import base64/);
    assert.match(operationsFile, /multipart_files\["file"\] = \("file", base64\.b64decode\(file\), "application\/octet-stream"\)/);
    assert.match(operationsFile, /multipart_files\["label"\] = \(None, str\(label\)\)/);
});

test("node sse preview exposes message endpoint and per-session server", () => {
    const preview = createPreviewResponse({
        ...postmanBase,
        serverConfig: {
            ...postmanBase.serverConfig,
            transport: "sse",
        },
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            features: {
                documentation: true,
                docker: false,
                tests: false,
                verification: true,
            },
        },
    });

    assert.equal(preview.verification?.status, "passed");
    const indexFile = getFileContent(preview, "src/index.ts");
    assert.match(indexFile, /const sessions: Record<string, \{ transport: SSEServerTransport; server: McpServer \}> = \{\};/);
    assert.match(indexFile, /const transport = new SSEServerTransport\("\/messages", res\);/);
    assert.match(indexFile, /const server = createServer\(\);/);
    assert.match(indexFile, /await session\.transport\.handlePostMessage\(req, res\);/);
    assert.match(indexFile, /Missing sessionId parameter/);
});

// ---------------------------------------------------------------------------
// Compact mode (meta-tools) — Node target
// ---------------------------------------------------------------------------

const compactMultiOpApiModel = buildOpenAPIModel({
    openapi: "3.1.0",
    info: { title: "Catalog API", version: "1.0.0", description: "Two-operation fixture" },
    servers: [{ url: "https://catalog.example.com" }],
    paths: {
        "/items/{itemId}": {
            get: {
                operationId: "get-item",
                summary: "Fetch an item by id",
                parameters: [
                    { name: "itemId", in: "path", required: true, description: "Item id", schema: { type: "string" } },
                    { name: "verbose", in: "query", required: false, description: "Verbose flag", schema: { type: "boolean" } },
                ],
                responses: { "200": { description: "OK" } },
            },
        },
        "/items": {
            post: {
                operationId: "create-item",
                summary: "Create an item",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: { name: { type: "string" } },
                                required: ["name"],
                            },
                        },
                    },
                },
                responses: { "201": { description: "Created" } },
            },
        },
    },
});

const compactMultiOpBase: Omit<GeneratorRequest, "exportConfig"> = {
    spec: {
        info: { title: "Catalog API", version: "1.0.0", description: "Two-operation fixture" },
        baseUrl: "https://catalog.example.com",
        apiModel: compactMultiOpApiModel,
    },
    tools: [
        {
            endpointId: "GET-/items/{itemId}",
            enabled: true,
            toolName: "get-item",
            description: "Fetch an item by id",
            parameters: [
                { name: "item_id", originalName: "itemId", type: "string", required: true, description: "Item id", location: "path", schema: { type: "string" } },
                { name: "verbose", originalName: "verbose", type: "boolean", required: false, description: "Verbose flag", location: "query", schema: { type: "boolean" } },
            ],
        },
        {
            endpointId: "POST-/items",
            enabled: true,
            toolName: "create-item",
            description: "Create an item",
            parameters: [
                { name: "name", originalName: "name", type: "string", required: true, description: "Item name", location: "body", schema: { type: "string" } },
            ],
            bodySchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            bodyContentType: "application/json",
        },
    ],
    serverConfig: { name: "catalog-mcp", version: "1.0.0", host: "localhost", port: 8080, transport: "stdio" },
    authConfig: { type: "apiKey", apiKey: { name: "x-api-key", in: "header" } },
};

test("compact mode registers exactly the three meta-tools and no per-operation tools", () => {
    const preview = createPreviewResponse({
        ...compactMultiOpBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            compactMode: true,
            features: { documentation: false, docker: false, tests: true, verification: true },
        },
    });

    // Generated project still passes fast verification in compact mode.
    assert.equal(preview.verification?.status, "passed");

    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    // Exactly the three meta-tools are registered.
    const registered = [...serverFile.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(registered, ["list_api_endpoints", "get_api_endpoint_schema", "invoke_api_endpoint"]);
    // No per-operation tools leak through (the operation tool names are absent).
    assert.doesNotMatch(serverFile, /registerTool\(\s*"get_item"/);
    assert.doesNotMatch(serverFile, /registerTool\(\s*"create_item"/);

    // The operations module is still emitted — invoke dispatches through it.
    const operationsFile = getFileContent(preview, "src/api/operations.ts");
    assert.match(operationsFile, /export const operations = \[/);

    // The immutable registry carries both operation ids and their stored templates.
    assert.match(serverFile, /const META_OPERATIONS: readonly MetaOperation\[\] = Object\.freeze\(\[/);
    assert.match(serverFile, /id: "GET-\/items\/\{itemId\}"/);
    assert.match(serverFile, /id: "POST-\/items"/);
    assert.match(serverFile, /path: "\/items\/\{itemId\}"/);
    // Safe-dispatch: invoke refuses unknown ids and validates before dispatch.
    assert.match(serverFile, /type: "unknown_operation"/);
    assert.match(serverFile, /operation\.validator\.safeParse/);
    // Meta-tool annotations: list/get read-only, invoke open-world & not read-only.
    assert.match(serverFile, /"list_api_endpoints",[\s\S]*readOnlyHint: true/);
    assert.match(serverFile, /"invoke_api_endpoint",[\s\S]*readOnlyHint: false,[\s\S]*openWorldHint: true/);
});

test("non-compact mode remains per-operation (regression) and is byte-identical to omitting the flag", () => {
    const config = {
        language: "node" as const,
        framework: "mcp-ts-sdk" as const,
        packageManager: "npm" as const,
        features: { documentation: false, docker: false, tests: false, verification: true },
    };

    const withoutFlag = createPreviewResponse({ ...compactMultiOpBase, exportConfig: config });
    const withFalseFlag = createPreviewResponse({ ...compactMultiOpBase, exportConfig: { ...config, compactMode: false } });

    const serverWithout = getFileContent(withoutFlag, "src/mcp/server.ts");
    const serverFalse = getFileContent(withFalseFlag, "src/mcp/server.ts");

    // compactMode:false must be byte-identical to omitting the flag entirely.
    assert.equal(serverFalse, serverWithout);
    // And it still registers one tool per operation, no meta-tools.
    assert.match(serverWithout, /server\.registerTool\(\s*"get_item"/);
    assert.match(serverWithout, /server\.registerTool\(\s*"create_item"/);
    assert.doesNotMatch(serverWithout, /list_api_endpoints/);
    assert.doesNotMatch(serverWithout, /META_OPERATIONS/);
});

test("compact invoke_api_endpoint safely dispatches known ids and rejects unknown ids / invalid args", async () => {
    const preview = createPreviewResponse({
        ...compactMultiOpBase,
        exportConfig: {
            language: "node",
            framework: "mcp-ts-sdk",
            packageManager: "npm",
            compactMode: true,
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    const serverFile = getFileContent(preview, "src/mcp/server.ts");
    const { tools, operationCalls } = loadNodeCompactServer(serverFile, compactMultiOpBase.tools.length);

    assert.deepEqual([...tools.keys()], ["list_api_endpoints", "get_api_endpoint_schema", "invoke_api_endpoint"]);

    // list_api_endpoints returns lightweight records for both operations, no schemas.
    const listResult = await tools.get("list_api_endpoints")!.handler({});
    const listed = listResult.structuredContent as { endpoints: Array<{ id: string; method: string; path: string }>; total_estimate: number };
    assert.equal(listed.total_estimate, 2);
    assert.equal([...listed.endpoints].map((entry) => entry.id).sort().join("|"), "GET-/items/{itemId}|POST-/items");
    assert.ok(!("parameters" in (listed.endpoints[0] as Record<string, unknown>)));

    // get_api_endpoint_schema returns full details for a known id.
    const schemaResult = await tools.get("get_api_endpoint_schema")!.handler({ endpointId: "GET-/items/{itemId}" });
    const schema = schemaResult.structuredContent as { id: string; parameters: Array<{ name: string; in: string }> };
    assert.equal(schema.id, "GET-/items/{itemId}");
    assert.ok(schema.parameters.some((parameter) => parameter.name === "item_id" && parameter.in === "path"));

    // (a) Unknown id -> unknown_operation, NO HTTP call.
    const unknown = await tools.get("invoke_api_endpoint")!.handler({ endpointId: "DELETE-/nope" });
    assert.equal(unknown.isError, true);
    assert.equal((unknown.structuredContent as { error: { type: string } }).error.type, "unknown_operation");
    assert.equal(operationCalls.length, 0);

    // (b) Missing required arg -> validation_error BEFORE any dispatch.
    const invalid = await tools.get("invoke_api_endpoint")!.handler({ endpointId: "GET-/items/{itemId}", parameters: { query: { verbose: true } } });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.structuredContent as { error: { type: string } }).error.type, "validation_error");
    assert.equal(operationCalls.length, 0);

    // (c) Valid known id -> dispatches through the stored operation with flattened args.
    const ok = await tools.get("invoke_api_endpoint")!.handler({ endpointId: "GET-/items/{itemId}", parameters: { path: { item_id: "abc" }, query: { verbose: true } } });
    assert.equal(ok.isError, undefined);
    const envelope = ok.structuredContent as { ok: boolean; endpointId: string; data: unknown };
    assert.equal(envelope.ok, true);
    assert.equal(envelope.endpointId, "GET-/items/{itemId}");
    assert.equal(operationCalls.length, 1);
    assert.equal(operationCalls[0].index, 0);
    // Flattening maps { path, query } onto flat argName-keyed operation args.
    assert.deepEqual(operationCalls[0].args, { item_id: "abc", verbose: true });

    // Body flattening: POST maps parameters.body's fields onto flat body args.
    const created = await tools.get("invoke_api_endpoint")!.handler({ endpointId: "POST-/items", parameters: { body: { name: "widget" } } });
    assert.equal((created.structuredContent as { ok: boolean }).ok, true);
    assert.equal(operationCalls.length, 2);
    assert.equal(operationCalls[1].index, 1);
    assert.deepEqual(operationCalls[1].args, { name: "widget" });
});

// Write a compact-mode Python project plus import stubs to a temp dir, import the
// generated `src/server.py` with a fake FastMCP that records the three meta-tools,
// invoke a sequence of calls against them, and return the JSON results. `httpx` is
// stubbed so invoke_api_endpoint's dispatch reaches the real per-operation request
// function and executes against a canned response (mirrors loadNodeCompactServer).
function runPythonCompactServer(
    preview: ReturnType<typeof createPreviewResponse>,
    calls: Array<{ tool: string; args: Record<string, unknown> }>
): Array<Record<string, unknown>> {
    const tempDir = mkdtempSync(join(tmpdir(), "mcpmint-pycompact-"));
    try {
        for (const file of preview.files) {
            const absolute = join(tempDir, file.name);
            mkdirSync(dirname(absolute), { recursive: true });
            writeFileSync(absolute, file.content, "utf8");
        }

        const srcDir = join(tempDir, "src");
        const fastmcpDir = join(srcDir, "fastmcp");
        mkdirSync(fastmcpDir, { recursive: true });
        // Fake FastMCP whose .tool(name=...) decorator records the handler by name.
        writeFileSync(join(fastmcpDir, "__init__.py"), `class FastMCP:
    registered = {}

    def __init__(self, name):
        self.name = name

    def tool(self, *args, **kwargs):
        name = kwargs.get("name")

        def decorator(function):
            FastMCP.registered[name] = function
            return function

        return decorator

    def http_app(self, *args, **kwargs):
        return None

    def run(self, *args, **kwargs):
        return None
`, "utf8");
        writeFileSync(join(fastmcpDir, "exceptions.py"), "class ToolError(Exception):\n    pass\n", "utf8");

        const mcpDir = join(srcDir, "mcp");
        mkdirSync(mcpDir, { recursive: true });
        writeFileSync(join(mcpDir, "__init__.py"), "", "utf8");
        writeFileSync(join(mcpDir, "types.py"), `class ToolAnnotations:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
`, "utf8");

        // httpx stub returning a canned JSON body so invoke's dispatch executes end to end.
        writeFileSync(join(srcDir, "httpx.py"), `class Response:
    status_code = 200
    headers = {"content-type": "application/json"}
    text = '{"ok": true}'

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_bytes(self):
        yield b'{"ok": true}'

    def json(self):
        return {"ok": True}


class Client:
    def __init__(self, *args, **kwargs):
        pass

    def stream(self, **kwargs):
        return Response()
`, "utf8");
        writeFileSync(join(srcDir, "dotenv.py"), "def load_dotenv(*args, **kwargs):\n    return True\n", "utf8");

        const driver = `import json
import sys

sys.path.insert(0, "src")

from fastmcp import FastMCP
import server

calls = json.loads(sys.argv[1])
results = []
for call in calls:
    handler = FastMCP.registered[call["tool"]]
    results.append(handler(**call["args"]))

print(json.dumps({"registered": list(FastMCP.registered.keys()), "results": results}))
`;
        writeFileSync(join(tempDir, "driver.py"), driver, "utf8");

        const output = execFileSync("python3", ["driver.py", JSON.stringify(calls)], {
            cwd: tempDir,
            encoding: "utf8",
        });
        const parsed = JSON.parse(output) as { registered: string[]; results: Array<Record<string, unknown>> };
        return [{ registered: parsed.registered }, ...parsed.results];
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

test("python compact mode registers exactly the three meta-tools and no per-operation @mcp.tool", () => {
    const preview = createPreviewResponse({
        ...compactMultiOpBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            compactMode: true,
            features: { documentation: false, docker: false, tests: true, verification: true },
        },
    });

    // Generated project still passes fast verification in compact mode.
    assert.equal(preview.verification?.status, "passed");

    const serverFile = getFileContent(preview, "src/server.py");
    // Exactly the three meta-tools are registered, in order.
    const registered = [...serverFile.matchAll(/@mcp\.tool\(\s*\n\s*name="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(registered, ["list_api_endpoints", "get_api_endpoint_schema", "invoke_api_endpoint"]);
    // No per-operation tool leaks through (operation display names are absent).
    assert.doesNotMatch(serverFile, /name="get_item"/);
    assert.doesNotMatch(serverFile, /name="create_item"/);

    // The operations module is still emitted — invoke dispatches through it.
    const operationsFile = getFileContent(preview, "src/operations.py");
    assert.match(operationsFile, /_operation\(/);

    // The immutable registry carries both operation ids and their stored templates.
    assert.match(serverFile, /META_OPERATIONS = \(/);
    assert.match(serverFile, /META_OPERATIONS_BY_ID = MappingProxyType\(/);
    assert.match(serverFile, /"id": "GET-\/items\/\{itemId\}"/);
    assert.match(serverFile, /"id": "POST-\/items"/);
    assert.match(serverFile, /"path": "\/items\/\{itemId\}"/);
    // Safe-dispatch: invoke refuses unknown ids and validates before dispatch, no eval.
    assert.match(serverFile, /"type": "unknown_operation"/);
    assert.match(serverFile, /_validate_operation_args\(operation, operation_args\)/);
    assert.doesNotMatch(serverFile, /\beval\(/);
    // Meta-tool annotations: list/get read-only + idempotent + not open-world; invoke open-world & not read-only.
    assert.match(serverFile, /name="list_api_endpoints",[\s\S]*readOnlyHint=True,[\s\S]*idempotentHint=True,[\s\S]*openWorldHint=False/);
    assert.match(serverFile, /name="invoke_api_endpoint",[\s\S]*readOnlyHint=False,[\s\S]*openWorldHint=True/);
});

test("python non-compact mode remains per-operation (regression) and is byte-identical to omitting the flag", () => {
    const config = {
        language: "python" as const,
        framework: "fastmcp" as const,
        packageManager: "npm" as const,
        features: { documentation: false, docker: false, tests: false, verification: true },
    };

    const withoutFlag = createPreviewResponse({ ...compactMultiOpBase, exportConfig: config });
    const withFalseFlag = createPreviewResponse({ ...compactMultiOpBase, exportConfig: { ...config, compactMode: false } });

    const serverWithout = getFileContent(withoutFlag, "src/server.py");
    const serverFalse = getFileContent(withFalseFlag, "src/server.py");

    // compactMode:false must be byte-identical to omitting the flag entirely.
    assert.equal(serverFalse, serverWithout);
    // And it still registers one tool per operation, no meta-tools.
    assert.match(serverWithout, /name="get_item"/);
    assert.match(serverWithout, /name="create_item"/);
    assert.doesNotMatch(serverWithout, /list_api_endpoints/);
    assert.doesNotMatch(serverWithout, /META_OPERATIONS/);
});

test("python compact invoke_api_endpoint safely dispatches known ids and rejects unknown ids / invalid args", () => {
    const preview = createPreviewResponse({
        ...compactMultiOpBase,
        exportConfig: {
            language: "python",
            framework: "fastmcp",
            packageManager: "npm",
            compactMode: true,
            features: { documentation: false, docker: false, tests: false, verification: true },
        },
    });

    const [{ registered }, list, schema, unknown, invalid, ok, created] = runPythonCompactServer(preview, [
        { tool: "list_api_endpoints", args: {} },
        { tool: "get_api_endpoint_schema", args: { endpointId: "GET-/items/{itemId}" } },
        { tool: "invoke_api_endpoint", args: { endpointId: "DELETE-/nope" } },
        { tool: "invoke_api_endpoint", args: { endpointId: "GET-/items/{itemId}", parameters: { query: { verbose: true } } } },
        { tool: "invoke_api_endpoint", args: { endpointId: "GET-/items/{itemId}", parameters: { path: { item_id: "abc" }, query: { verbose: true } } } },
        { tool: "invoke_api_endpoint", args: { endpointId: "POST-/items", parameters: { body: { name: "widget" } } } },
    ]);

    assert.deepEqual(registered as string[], ["list_api_endpoints", "get_api_endpoint_schema", "invoke_api_endpoint"]);

    // list_api_endpoints returns lightweight records for both operations, no schemas.
    const listed = list as { endpoints: Array<{ id: string }>; total_estimate: number };
    assert.equal(listed.total_estimate, 2);
    assert.equal(listed.endpoints.map((entry) => entry.id).sort().join("|"), "GET-/items/{itemId}|POST-/items");
    assert.ok(!("parameters" in (listed.endpoints[0] as Record<string, unknown>)));

    // get_api_endpoint_schema returns full details for a known id.
    const schemaResult = schema as { id: string; parameters: Array<{ name: string; in: string }> };
    assert.equal(schemaResult.id, "GET-/items/{itemId}");
    assert.ok(schemaResult.parameters.some((parameter) => parameter.name === "item_id" && parameter.in === "path"));

    // (a) Unknown id -> unknown_operation (closed registry, no HTTP call).
    assert.equal((unknown as { ok: boolean }).ok, false);
    assert.equal((unknown as { error: { type: string } }).error.type, "unknown_operation");

    // (b) Missing required arg -> validation_error BEFORE any dispatch.
    assert.equal((invalid as { ok: boolean }).ok, false);
    assert.equal((invalid as { error: { type: string } }).error.type, "validation_error");

    // (c) Valid known id -> dispatches through the stored operation, bounded envelope.
    const okEnvelope = ok as { ok: boolean; endpointId: string; data: unknown };
    assert.equal(okEnvelope.ok, true);
    assert.equal(okEnvelope.endpointId, "GET-/items/{itemId}");
    assert.deepEqual(okEnvelope.data, { ok: true });

    // Body flattening: POST maps parameters.body's fields onto the operation.
    assert.equal((created as { ok: boolean }).ok, true);
});
