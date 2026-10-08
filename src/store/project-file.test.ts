import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectFile, serializeProjectFile, type PortableProjectFile } from "./project-file.ts";

const fixture = {
    schemaVersion: 1,
    kind: "mcpmint-project",
    exportedAt: "2026-07-20T00:00:00.000Z",
    project: { id: "p1", name: "Billing", source: "billing.yaml", format: "openapi", endpointCount: 0, savedAt: 1 },
    data: {
        spec: {
            info: { title: "Billing", version: "1" },
            baseUrl: "https://api.example.com",
            endpoints: [],
            securitySchemes: {},
            apiModel: {
                source: { format: "openapi" },
                info: { title: "Billing", version: "1" },
                servers: [],
                baseUrls: [],
                securitySchemes: {},
                security: [],
                operations: [],
            },
        },
        specSource: "billing.yaml",
        specFormat: "openapi",
        tools: [],
        authConfig: { type: "none" },
        mcpServerAuthConfig: { type: "none", allowedOrigins: [] },
        serverConfig: { name: "billing", version: "1.0.0", host: "localhost", port: 8080, transport: "stdio" },
        exportConfig: { language: "node", framework: "mcp-ts-sdk", packageManager: "npm", verificationMode: "fast", compactMode: false, features: { documentation: true, docker: false, tests: true, verification: false } },
    },
} satisfies PortableProjectFile;

test("round trips a portable project file", () => {
    const parsed = parseProjectFile(serializeProjectFile(fixture));
    assert.deepEqual(parsed.project, fixture.project);
    assert.deepEqual(parsed.data.spec.apiModel, fixture.data.spec.apiModel);
    assert.equal(parsed.data.spec.info.title, "Billing");
});

test("rejects malformed, unsupported, and legacy project files", () => {
    assert.throws(() => parseProjectFile("not json"), /not valid JSON/);
    assert.throws(() => parseProjectFile('{"kind":"other","schemaVersion":1}'), /Unsupported project file/);
    assert.throws(() => parseProjectFile('{"kind":"mcpmint-project","schemaVersion":1,"project":{},"data":{}}'), /metadata/);
});

test("rejects corrupted project configuration and endpoint references", () => {
    const invalid = structuredClone(fixture);
    (invalid.data.serverConfig as { port: number }).port = 999999;
    assert.throws(() => parseProjectFile(JSON.stringify(invalid)), /65535/);
    const invalidModel = structuredClone(fixture);
    (invalidModel.data.spec.apiModel as unknown as { operations: unknown }).operations = "broken";
    assert.throws(() => parseProjectFile(JSON.stringify(invalidModel)), /array/);
});

test("portable display metadata is rebuilt from the canonical API model", () => {
    const file = structuredClone(fixture) as PortableProjectFile;
    file.project.endpointCount = 1;
    file.data.spec.endpoints.push({ id: "one", method: "GET", path: "/stale", parameters: [] });
    file.data.spec.apiModel!.operations.push({ id: "one", method: "POST", path: "/actual", parameters: [], responses: [] });
    const parsed = parseProjectFile(JSON.stringify(file));
    assert.equal(parsed.data.spec.endpoints[0].method, "POST");
    assert.equal(parsed.data.spec.endpoints[0].path, "/actual");
    file.project.endpointCount = 2;
    assert.throws(() => parseProjectFile(JSON.stringify(file)), /endpoint count/);
});

test("rejects deep configuration and dangling tool references before importing", () => {
    const badModel = structuredClone(fixture);
    (badModel.data.spec as unknown as { apiModel: object }).apiModel = {};
    assert.throws(() => parseProjectFile(JSON.stringify(badModel)), /configuration is invalid/);
    const badPort = structuredClone(fixture);
    badPort.data.serverConfig.port = 0;
    assert.throws(() => parseProjectFile(JSON.stringify(badPort)), /serverConfig.port/);
    const dangling = structuredClone(fixture) as PortableProjectFile;
    dangling.data.tools = [{ endpointId: "GET-/missing", enabled: false, toolName: "missing", description: "", parameters: [] }];
    assert.throws(() => parseProjectFile(JSON.stringify(dangling)), /refer to unique operations/);
    const missingAuth = structuredClone(fixture);
    delete (missingAuth.data as unknown as Record<string, unknown>).authConfig;
    assert.throws(() => parseProjectFile(JSON.stringify(missingAuth)), /authConfig/);
});

test("rejects hostile nesting and size without recursing into unbounded input", () => {
    const deep = structuredClone(fixture) as PortableProjectFile;
    const schema: Record<string, unknown> = {};
    let cursor = schema;
    for (let i = 0; i < 70; i++) { const next = {}; cursor.child = next; cursor = next; }
    (deep.data.spec.apiModel as unknown as Record<string, unknown>).hostile = schema;
    assert.throws(() => parseProjectFile(JSON.stringify(deep)), /deeply nested or complex/);
    assert.throws(() => parseProjectFile(' '.repeat(20 * 1024 * 1024 + 1)), /20 MB/);
});
