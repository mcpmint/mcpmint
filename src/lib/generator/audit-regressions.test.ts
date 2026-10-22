import test from "node:test";
import assert from "node:assert/strict";

import { parseOpenAPIFromContent } from "../parsers/openapi.ts";
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
