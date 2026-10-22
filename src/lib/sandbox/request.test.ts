import assert from "node:assert/strict";
import test from "node:test";
import { createMockMcpResponse, inspectToolRequest, sampleArguments } from "./request.ts";
import type { GenerationTool } from "@/lib/generator/types";

const tool: GenerationTool = {
    id: "POST-/users/{id}",
    displayName: "update_user",
    functionName: "update_user",
    description: "Update a user",
    method: "POST",
    path: "/users/{id}",
    authStrategy: { strategy: "none", source: "none" },
    params: [
        { argName: "id", sourceName: "id", type: "string", required: true, description: "", location: "path", schema: { type: "string", example: "u-1" } },
        { argName: "verbose", sourceName: "verbose", type: "boolean", required: false, description: "", location: "query" },
        { argName: "name", sourceName: "name", type: "string", required: true, description: "", location: "body", schema: { type: "string" } },
    ],
    requestBody: { contentType: "application/json", contentKind: "flattenedObject", params: [] },
};

test("inspects the exact stored method, path, query, headers, and body", () => {
    const request = inspectToolRequest(tool, "https://api.example.com/", { id: "u/1", verbose: true, name: "Ada" });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://api.example.com/users/u%2F1?verbose=true");
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(request.body || ""), { name: "Ada" });
});

test("omits query parameters that the caller did not give", () => {
    const request = inspectToolRequest(tool, "https://api.example.com", { id: "u-1", name: "Ada" });
    assert.equal(request.url, "https://api.example.com/users/u-1");
});

test("requires mandatory arguments and creates schema-based samples", () => {
    assert.throws(() => inspectToolRequest(tool, "https://api.example.com", {}), /Missing required arguments: id, name/);
    assert.deepEqual(sampleArguments(tool), { id: "u-1", name: "sample" });
});

test("wraps mock results as MCP content and structured content", () => {
    const response = createMockMcpResponse(200, { ok: true });
    assert.equal(response.isError, false);
    assert.deepEqual(response.structuredContent, { ok: true });
    assert.equal(response.http.mode, "mock");
});
