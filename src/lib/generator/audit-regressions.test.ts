import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseOpenAPIFromContent } from "../parsers/openapi.ts";
import { buildPostmanApiModel } from "../api-model/postman.ts";
import { buildGeneratorRequest, type BuildRequestOptions } from "../../../cli/src/build-request.ts";
import { prepareGeneratedProject } from "./core.ts";

// Regression tests for the 2026-10-22 repository audit. Each test names the
// failure it guards against.

async function requestFor(spec: object, options: Partial<BuildRequestOptions> = {}) {
    const parsed = await parseOpenAPIFromContent(JSON.stringify(spec), "spec.json");
    return buildGeneratorRequest(parsed, {
        language: "node",
        transport: "stdio",
        packageManager: "npm",
        compactMode: false,
        host: "localhost",
        port: 8080,
        verificationMode: "fast",
        features: { documentation: false, docker: false, tests: true, verification: false },
        ...options,
    });
}

function nestedArray(levels: number): Record<string, unknown> {
    let schema: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < levels; level++) schema = { type: "array", minItems: 100, items: schema };
    return schema;
}

test("nested minItems arrays do not expand generated test samples without bound", async () => {
    const request = await requestFor({
        openapi: "3.0.3",
        info: { title: "Bomb", version: "1" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
            "/items": {
                post: {
                    operationId: "createItems",
                    requestBody: { required: true, content: { "application/json": { schema: nestedArray(5) } } },
                    responses: { "200": { description: "ok" } },
                },
            },
        },
    });
    for (const language of ["node", "python"] as const) {
        const { project } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language, framework: language === "node" ? "mcp-ts-sdk" : "fastmcp" } });
        const bytes = [...project.files.values()].reduce((total, content) => total + content.length, 0);
        assert.ok(bytes < 2_000_000, `${language} output is ${bytes} bytes`);
    }
});

const dotSegmentSpec = {
    openapi: "3.0.3",
    info: { title: "Sessions", version: "1" },
    servers: [{ url: "https://api.example.com" }],
    paths: {
        "/users/{id}/sessions": {
            delete: {
                operationId: "deleteUserSessions",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: { "204": { description: "ok" } },
            },
        },
    },
};

test("generated Node servers reject dot-segment path values", async () => {
    const request = await requestFor(dotSegmentSpec);
    const { project } = prepareGeneratedProject(request);
    const directory = mkdtempSync(join(tmpdir(), "mcpmint-dots-"));
    try {
        const file = join(directory, "serialization.ts");
        writeFileSync(file, project.files.get("src/api/serialization.ts")!);
        const { serializePathParameter } = await import(pathToFileURL(file).href);
        for (const value of [".", ".."]) {
            assert.throws(() => serializePathParameter("id", value, { location: "path" }), /cannot be/, value);
        }
        // Encoded dots are encoded again, so they cannot form a dot segment.
        assert.equal(serializePathParameter("id", "%2e%2e", { location: "path" }), "%252e%252e");
        assert.equal(serializePathParameter("id", "a.b", { location: "path" }), "a.b");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("generated Python servers reject dot-segment path values", async () => {
    const request = await requestFor(dotSegmentSpec, { language: "python" });
    const { project } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "python", framework: "fastmcp" } });
    const directory = mkdtempSync(join(tmpdir(), "mcpmint-dots-py-"));
    try {
        writeFileSync(join(directory, "serialization.py"), project.files.get("src/serialization.py")!);
        const output = execFileSync("python3", ["-c", `
import serialization
for value in [".", ".."]:
    try:
        serialization.serialize_path_parameter("id", value, {"location": "path"})
        print("accepted", value)
    except ValueError:
        pass
print(serialization.serialize_path_parameter("id", "%2e%2e", {"location": "path"}))
print(serialization.serialize_path_parameter("id", "a.b", {"location": "path"}))
`], { cwd: directory, encoding: "utf8" });
        assert.equal(output.trim(), "%252e%252e\na.b");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("Python servers compile when names collide with keywords or generated locals", async () => {
    const request = await requestFor({
        openapi: "3.0.3",
        info: { title: "Names", version: "1" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
            "/files/{path}": {
                get: {
                    operationId: "import",
                    parameters: [
                        { name: "path", in: "path", required: true, schema: { type: "string" } },
                        { name: "from", in: "query", schema: { type: "string" } },
                        { name: "params", in: "query", schema: { type: "string" } },
                    ],
                    responses: { "200": { description: "ok" } },
                },
            },
            "/mcp": { get: { operationId: "mcp", responses: { "200": { description: "ok" } } } },
        },
    }, { language: "python" });
    const python = { ...request, exportConfig: { ...request.exportConfig, language: "python" as const, framework: "fastmcp" as const } };
    const { project } = prepareGeneratedProject(python);
    const directory = mkdtempSync(join(tmpdir(), "mcpmint-names-py-"));
    try {
        for (const [name, content] of project.files) {
            if (!name.endsWith(".py")) continue;
            const file = join(directory, name.replaceAll("/", "__"));
            writeFileSync(file, content);
            execFileSync("python3", ["-m", "py_compile", file]);
        }
        const operations = project.files.get("src/operations.py")!;
        assert.match(operations, /serialize_path_parameter\("path", path_2,/);
        assert.match(operations, /append_serialized_parameter\(params, "params", params_2,/);
        assert.doesNotMatch(project.files.get("src/server.py")!, /^def (mcp|import)\(/m);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }

    // Node keeps the original names, because it reads arguments by key.
    const { project: node } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "node", framework: "mcp-ts-sdk" } });
    assert.match(node.files.get("src/api/operations.ts")!, /args\["from"\]/);
});

test("Postman requests with different API keys keep separate auth schemes", () => {
    const apiKey = (name: string) => ({ type: "apikey", apikey: [{ key: "key", value: name }] });
    const model = buildPostmanApiModel({
        info: { name: "Auth", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
        item: [
            { name: "A", request: { method: "GET", url: "https://a.example/items", auth: apiKey("X-Key-A") } },
            { name: "B", request: { method: "GET", url: "https://b.example/items", auth: apiKey("X-Key-B") } },
            { name: "C", request: { method: "GET", url: "https://a.example/other", auth: apiKey("X-Key-A") } },
        ],
    } as Parameters<typeof buildPostmanApiModel>[0]);

    assert.deepEqual(model.securitySchemes, {
        apiKey: { type: "apiKey", in: "header", name: "X-Key-A" },
        apiKey_2: { type: "apiKey", in: "header", name: "X-Key-B" },
    });
    assert.deepEqual(model.operations.map((operation) => operation.security), [
        [{ apiKey: [] }],
        [{ apiKey_2: [] }],
        [{ apiKey: [] }],
    ]);
});

const relativeServerSpec = {
    openapi: "3.0.3",
    info: { title: "Pets", version: "1" },
    servers: [{ url: "/api/v3" }],
    paths: { "/pet": { get: { operationId: "getPet", responses: { "200": { description: "ok" } } } } },
};

test("relative servers resolve against the URL the spec was imported from", async () => {
    const parsed = await parseOpenAPIFromContent(JSON.stringify(relativeServerSpec), "openapi.json", "https://petstore3.swagger.io/api/v3/openapi.json");
    assert.equal(parsed.baseUrl, "https://petstore3.swagger.io/api/v3");

    const swagger = await parseOpenAPIFromContent(JSON.stringify({
        swagger: "2.0", info: { title: "Old", version: "1" }, basePath: "/v1",
        paths: { "/items": { get: { operationId: "list", responses: { "200": { description: "ok" } } } } },
    }), "swagger.json", "https://legacy.example.com/docs/swagger.json");
    assert.equal(swagger.baseUrl, "https://legacy.example.com/v1");
});

test("relative servers in file imports use the base URL the user enters", async () => {
    const request = await requestFor(relativeServerSpec);
    assert.throws(() => prepareGeneratedProject(request), /Enter a full API base URL/);

    const { plan } = prepareGeneratedProject({ ...request, spec: { ...request.spec, baseUrl: "https://petstore3.swagger.io" } });
    assert.equal(plan.tools[0].baseUrl, "https://petstore3.swagger.io/api/v3");
});

test("an optional JSON body with required fields stays one optional body argument", async () => {
    const request = await requestFor({
        openapi: "3.0.3",
        info: { title: "Search", version: "1" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
            "/search": {
                post: {
                    operationId: "search",
                    requestBody: {
                        required: false,
                        content: { "application/json": { schema: { type: "object", required: ["term"], properties: { term: { type: "string" } } } } },
                    },
                    responses: { "200": { description: "ok" } },
                },
            },
        },
    });
    const { plan } = prepareGeneratedProject(request);
    const tool = plan.tools[0];
    assert.equal(tool.requestBody?.contentKind, "rawJsonObject");
    assert.deepEqual(tool.params.map((param) => [param.argName, param.required]), [["body", false]]);
});

test("Swagger 2 collectionFormat controls array serialization", async () => {
    const parameter = (name: string, collectionFormat?: string) => ({ name, in: "query", type: "array", items: { type: "string" }, ...(collectionFormat ? { collectionFormat } : {}) });
    const parsed = await parseOpenAPIFromContent(JSON.stringify({
        swagger: "2.0",
        info: { title: "Tags", version: "1" },
        host: "api.example.com",
        paths: {
            "/items": {
                get: {
                    operationId: "list",
                    parameters: [parameter("byDefault"), parameter("csv", "csv"), parameter("multi", "multi"), parameter("ssv", "ssv"), parameter("pipes", "pipes")],
                    responses: { "200": { description: "ok" } },
                },
            },
        },
    }), "swagger.json");
    const serialization = Object.fromEntries(parsed.apiModel!.operations[0].parameters.map((item) => [item.name, [item.style, item.explode]]));
    assert.deepEqual(serialization, {
        byDefault: ["form", false],
        csv: ["form", false],
        multi: ["form", true],
        ssv: ["spaceDelimited", false],
        pipes: ["pipeDelimited", false],
    });
});

test("compact mode keeps operation tags and accepts cookie parameters", async () => {
    const request = await requestFor({
        openapi: "3.0.3",
        info: { title: "Pets", version: "1" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
            "/pets": {
                get: {
                    operationId: "listPets",
                    tags: ["pets"],
                    parameters: [{ name: "session", in: "cookie", required: true, schema: { type: "string" } }],
                    responses: { "200": { description: "ok" } },
                },
            },
        },
    }, { compactMode: true });

    const { project: node } = prepareGeneratedProject(request);
    const server = node.files.get("src/mcp/server.ts")!;
    assert.match(server, /tags: \["pets"\] as string\[\]/);
    assert.match(server, /cookie: z\.record\(z\.unknown\(\)\)\.optional\(\)/);

    const { project: python } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "python", framework: "fastmcp" } });
    assert.match(python.files.get("src/server.py")!, /"tags": \["pets"\]/);
});

test("Python servers parse +json responses as JSON", async () => {
    const request = await requestFor(dotSegmentSpec);
    const { project } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "python", framework: "fastmcp" } });
    const client = project.files.get("src/api_client.py")!;
    const start = client.indexOf("def response_to_tool_result");
    const source = client.slice(start).split("\n\n\n")[0];
    const output = execFileSync("python3", ["-c", `
import json
class ToolError(Exception): pass
class FakeResponse:
    status_code = 200
    def __init__(self, content_type, body):
        self.headers = {"content-type": content_type}
        self.text = body
    def json(self):
        return json.loads(self.text)
${source.replace("httpx.Response", "object")}
print(json.dumps(response_to_tool_result(FakeResponse("application/vnd.api+json; charset=utf-8", '{"data": {"id": "1"}}'))))
print(json.dumps(response_to_tool_result(FakeResponse("text/plain", "hi"))))
`], { encoding: "utf8" });
    assert.equal(output.trim(), '{"data": {"id": "1"}}\n{"text": "hi"}');
});

test("generated packages expose the command that server.json launches", async () => {
    const request = await requestFor(dotSegmentSpec);
    const { project: node } = prepareGeneratedProject(request);
    const pkg = JSON.parse(node.files.get("package.json")!);
    assert.equal(pkg.bin[request.serverConfig.name], "dist/src/index.js");
    assert.deepEqual(pkg.files, ["dist"]);
    assert.equal(pkg.scripts.prepack, "npm run build");
    assert.ok(node.files.get("src/index.ts")!.startsWith("#!/usr/bin/env node\n"));

    const { project: python } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "python", framework: "fastmcp" } });
    assert.match(python.files.get("pyproject.toml")!, new RegExp(`\\[project\\.scripts\\]\\n"${request.serverConfig.name}" = "server:main"`));
    assert.match(python.files.get("src/server.py")!, /def main\(\) -> None:\n {4}mcp\.run\(transport="stdio"\)\n\n\nif __name__ == "__main__":\n {4}main\(\)/);
});

test("server variables with special characters are replaced literally", async () => {
    const parsed = await parseOpenAPIFromContent(JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Vars", version: "1" },
        servers: [{ url: "https://{region(}.example.com/{base}", variables: { "region(": { default: "eu" }, base: { default: "$&v1" } } }],
        paths: { "/items": { get: { operationId: "list", responses: { "200": { description: "ok" } } } } },
    }), "openapi.json");
    assert.equal(parsed.baseUrl, "https://eu.example.com/$&v1");
});

test("Python bearer check rejects non-ASCII headers instead of raising", async () => {
    const request = await requestFor(dotSegmentSpec, { transport: "http", mcpServerAuthType: "bearer" });
    const { project } = prepareGeneratedProject({ ...request, exportConfig: { ...request.exportConfig, language: "python", framework: "fastmcp" } });
    const access = project.files.get("src/access.py")!;
    const start = access.indexOf("def is_bearer_authorized");
    const source = access.slice(start).split("\n\n\n")[0];
    const output = execFileSync("python3", ["-c", `
import hmac
${source}
print(is_bearer_authorized("Bearer s3cret", "s3cret"), is_bearer_authorized("Bearer é", "s3cret"), is_bearer_authorized("Bearer töken".encode("utf-8").decode("latin-1"), "töken"))
`], { encoding: "utf8" });
    assert.equal(output.trim(), "True False True");
});
