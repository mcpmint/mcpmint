import assert from "node:assert/strict";
import test from "node:test";
import { projectToolsToScanTools } from "./from-project.ts";

test("builds scanner input from canonical operation metadata and configured parameters", () => {
    const tools = projectToolsToScanTools({
        source: { format: "openapi" },
        info: { title: "Example", version: "1" },
        servers: [],
        baseUrls: [],
        securitySchemes: {},
        security: [],
        operations: [{
            id: "DELETE-/users/{id}",
            method: "DELETE",
            path: "/users/{id}",
            tags: ["Users"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: [],
        }],
    }, [{
        endpointId: "DELETE-/users/{id}",
        enabled: true,
        toolName: "delete_user",
        description: "Delete one user.",
        parameters: [{
            name: "id",
            originalName: "id",
            type: "string",
            required: true,
            description: "User identifier",
            location: "path",
        }],
    }]);

    assert.equal(tools[0].method, "DELETE");
    assert.equal(tools[0].path, "/users/{id}");
    assert.equal(tools[0].annotations?.destructiveHint, true);
    assert.deepEqual((tools[0].inputSchema as { required: string[] }).required, ["id"]);
});
