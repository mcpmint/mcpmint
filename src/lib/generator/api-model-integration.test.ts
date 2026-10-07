import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenAPIModel } from "../api-model/openapi.ts";
import { buildPostmanApiModel } from "../api-model/postman.ts";
import { apiModelToParsedSpec } from "../api-model/legacy.ts";
import { parseGeneratorRequestPayload } from "./request.ts";
import { createPreviewResponse } from "./index.ts";
import { schemaToZodType } from "./schema.ts";

test("openapi model applies operation parameter overrides and preserves path servers", () => {
    const model = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Inventory", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
            "/items/{id}": {
                servers: [{ url: "https://regional.example.com" }],
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Path id" },
                    { name: "include", in: "query", schema: { type: "string" }, description: "Path-level include" },
                ],
                get: {
                    parameters: [
                        {
                            name: "include",
                            in: "query",
                            schema: { type: "array", items: { type: "string" } },
                            style: "form",
                            explode: false,
                            description: "Operation-level include",
                        },
                    ],
                    responses: {
                        "200": {
                            description: "OK",
                            headers: {
                                "X-Rate-Limit": {
                                    description: "Remaining requests",
                                    schema: { type: "integer", default: 10 },
                                    example: 9,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    const operation = model.operations[0];
    const includeParameters = operation.parameters.filter((parameter) =>
        parameter.in === "query" && parameter.name === "include"
    );

    assert.equal(includeParameters.length, 1);
    assert.equal(includeParameters[0].description, "Operation-level include");
    assert.deepEqual(includeParameters[0].schema, { type: "array", items: { type: "string" } });
    assert.equal(includeParameters[0].explode, false);
    assert.equal(operation.pathServers?.[0]?.url, "https://regional.example.com");
    assert.deepEqual(operation.responses[0].headers?.["X-Rate-Limit"], {
        description: "Remaining requests",
        required: undefined,
        deprecated: undefined,
        schema: { type: "integer", default: 10 },
        style: undefined,
        explode: undefined,
        example: 9,
        examples: undefined,
    });
});

test("generator request preserves apiModel and plans from canonical operation metadata", () => {
    const apiModel = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Billing", version: "1.0.0" },
        servers: [{ url: "https://canonical.example.com" }],
        paths: {
            "/canonical/{id}": {
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string" } },
                ],
                post: {
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: { amount: { type: "number" } },
                                    required: ["amount"],
                                },
                            },
                        },
                    },
                    responses: { "201": { description: "Created" } },
                },
            },
        },
    });

    const payload = parseGeneratorRequestPayload({
        spec: {
            info: { title: "Billing", version: "1.0.0" },
            baseUrl: "https://legacy.example.com",
            apiModel,
        },
        tools: [{
            endpointId: "POST-/canonical/{id}",
            enabled: true,
            toolName: "charge",
            description: "Charge customer",
            parameters: [
                {
                    name: "id",
                    originalName: "id",
                    type: "string",
                    required: true,
                    description: "Customer id",
                    location: "query",
                },
                {
                    name: "amount",
                    originalName: "amount",
                    type: "number",
                    required: true,
                    description: "Charge amount",
                    location: "body",
                    schema: { type: "number" },
                },
            ],
            bodyContentType: "text/plain",
        }],
        serverConfig: {
            name: "billing",
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
            features: { verification: true },
        },
    });

    const preview = createPreviewResponse(payload);
    const operationsFile = preview.files.find((file) => file.name === "src/api/operations.ts")?.content || "";
    const envFile = preview.files.find((file) => file.name === ".env.example")?.content || "";

    assert.match(envFile, /API_BASE_URL=\n/);
    assert.match(operationsFile, /path = path\.replace\("\{id\}"/);
    assert.match(operationsFile, /requestHeaders\["Content-Type"\] = "application\/json"/);
});

test("openapi model preserves rich OpenAPI 3 operation metadata", () => {
    const model = buildOpenAPIModel({
        openapi: "3.1.0",
        info: { title: "Catalog", version: "1.0.0" },
        servers: [{
            url: "https://{tenant}.api.example.com/{version}",
            variables: {
                tenant: { default: "demo", enum: ["demo", "acme"] },
                version: { default: "v2", description: "API version" },
            },
        }],
        components: {
            securitySchemes: {
                bearerAuth: { type: "http", scheme: "bearer" },
                apiKey: { type: "apiKey", in: "query", name: "key" },
            },
        },
        security: [{ bearerAuth: [] }],
        paths: {
            "/items/{id}": {
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string", default: "item_1" },
                        style: "simple",
                        explode: false,
                    },
                    {
                        name: "filter",
                        in: "query",
                        schema: { type: "object", properties: { color: { type: "string" } } },
                        style: "deepObject",
                        explode: true,
                    },
                ],
                post: {
                    security: [{ apiKey: [] }],
                    parameters: [
                        {
                            name: "filter",
                            in: "query",
                            schema: {
                                oneOf: [
                                    { type: "string", default: "all" },
                                    { type: "array", items: { type: "string" } },
                                ],
                            },
                            style: "form",
                            explode: false,
                            allowReserved: true,
                            examples: { colors: { value: ["red", "blue"] } },
                        },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    allOf: [
                                        {
                                            type: "object",
                                            properties: {
                                                name: { type: "string", example: "Widget" },
                                            },
                                            required: ["name"],
                                        },
                                        {
                                            type: "object",
                                            properties: {
                                                metadata: {
                                                    type: "object",
                                                    properties: {
                                                        tags: {
                                                            type: "array",
                                                            items: { anyOf: [{ type: "string" }, { type: "integer" }] },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                },
                                example: { name: "Widget" },
                            },
                            "application/merge-patch+json": {
                                schema: { type: "object", additionalProperties: true },
                            },
                        },
                    },
                    responses: { "200": { description: "OK" } },
                },
            },
        },
    });

    assert.deepEqual(model.baseUrls, ["https://demo.api.example.com/v2"]);
    assert.equal(model.servers[0].url, "https://{tenant}.api.example.com/{version}");
    assert.equal(model.servers[0].variables?.tenant.default, "demo");

    const operation = model.operations[0];
    assert.deepEqual(operation.security, [{ apiKey: [] }]);
    assert.equal(operation.parameters.length, 2);
    assert.equal(operation.parameters[1].source?.level, "operation");
    assert.equal(operation.parameters[1].style, "form");
    assert.equal(operation.parameters[1].explode, false);
    assert.equal(operation.parameters[1].allowReserved, true);
    assert.deepEqual(operation.parameters[1].examples?.colors.value, ["red", "blue"]);
    assert.equal(operation.requestBody?.content.length, 2);
    assert.equal(operation.requestBody?.content[0].mediaType, "application/json");
    assert.equal(operation.requestBody?.content[1].mediaType, "application/merge-patch+json");

    const parsed = apiModelToParsedSpec(model);
    assert.equal(parsed.baseUrl, "https://demo.api.example.com/v2");
    assert.equal(parsed.endpoints[0].parameters[1].type, "string | string[]");
});

test("openapi model converts Swagger 2 security definitions, consumes, produces, and form data", () => {
    const model = buildOpenAPIModel({
        swagger: "2.0",
        info: { title: "Uploads", version: "1.0.0" },
        host: "uploads.example.com",
        basePath: "/api",
        schemes: ["https"],
        consumes: ["multipart/form-data"],
        produces: ["application/json", "text/csv"],
        securityDefinitions: {
            basicAuth: { type: "basic" },
            apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
        security: [{ basicAuth: [] }],
        paths: {
            "/files": {
                post: {
                    security: [],
                    parameters: [
                        { name: "file", in: "formData", required: true, type: "file", description: "Upload" },
                        { name: "tags", in: "formData", type: "array", items: { type: "string" }, collectionFormat: "multi" },
                    ],
                    responses: {
                        "200": {
                            description: "OK",
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: { id: { type: "string", default: "file_1" } },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    assert.equal(model.baseUrls[0], "https://uploads.example.com/api");
    assert.deepEqual(model.security, [{ basicAuth: [] }]);
    assert.deepEqual(model.operations[0].security, []);
    assert.equal(model.securitySchemes.basicAuth.type, "http");
    assert.equal(model.securitySchemes.basicAuth.scheme, "basic");
    assert.equal(model.operations[0].requestBody?.content[0].mediaType, "multipart/form-data");
    assert.deepEqual(model.operations[0].requestBody?.content[0].schema?.required, ["file"]);
    assert.equal(
        (model.operations[0].requestBody?.content[0].schema?.properties as Record<string, Record<string, unknown>>).tags.collectionFormat,
        "multi"
    );
    assert.deepEqual(
        model.operations[0].responses[0].content?.map((content) => content.mediaType),
        ["application/json", "text/csv"]
    );
});

test("postman model resolves variables, inheritance, disabled items, query sources, auth headers, and body modes", () => {
    const model = buildPostmanApiModel({
        info: {
            name: "Postman Advanced",
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [
            { key: "baseUrl", value: "https://collection.example.com" },
            { key: "version", value: "v1" },
            { key: "tenant", value: "collection-tenant" },
            { key: "traceId", value: "collection-trace" },
        ],
        auth: {
            type: "apikey",
            apikey: [
                { key: "in", value: "header" },
                { key: "key", value: "X-API-Key" },
                { key: "value", value: "{{apiKey}}" },
            ],
        },
        item: [
            {
                name: "Disabled Folder",
                disabled: true,
                item: [{
                    name: "Hidden",
                    request: { method: "GET", url: "{{baseUrl}}/hidden" },
                }],
            },
            {
                name: "Users",
                auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
                item: [
                    {
                        name: "List Users",
                        request: {
                            method: "GET",
                            url: {
                                raw: "{{baseUrl}}/{{version}}/users?raw=true&tenant={{tenant}}",
                                path: ["{{version}}", "{{resource}}"],
                                query: [
                                    { key: "structured", value: "yes" },
                                    { key: "tenant", value: "{{tenant}}" },
                                    { key: "skip", value: "no", disabled: true },
                                ],
                                variable: [{ key: "resource", value: "users" }],
                            },
                            header: [
                                { key: "Authorization", value: "Bearer {{token}}" },
                                { key: "X-Trace", value: "{{traceId}}" },
                            ],
                        },
                    },
                    {
                        name: "Disabled Request",
                        disabled: true,
                        request: { method: "GET", url: "{{baseUrl}}/disabled" },
                    },
                    {
                        name: "Create User",
                        request: {
                            method: "POST",
                            url: "{{baseUrl}}/{{version}}/users",
                            auth: { type: "noauth" },
                            body: {
                                mode: "raw",
                                raw: "{\"name\":\"Ada\",\"active\":true}",
                                options: { raw: { language: "json" } },
                            },
                        },
                    },
                ],
            },
            {
                name: "Update Text",
                request: {
                    method: "PATCH",
                    url: "{{baseUrl}}/{{version}}/text",
                    body: { mode: "raw", raw: "hello", options: { raw: { language: "text" } } },
                },
            },
            {
                name: "Upload",
                request: {
                    method: "POST",
                    url: "{{baseUrl}}/{{version}}/upload",
                    body: {
                        mode: "formdata",
                        formdata: [
                            { key: "file", type: "file" },
                            { key: "title", value: "Report" },
                            { key: "ignore", value: "x", disabled: true },
                        ],
                    },
                },
            },
            {
                name: "Login",
                request: {
                    method: "POST",
                    url: "{{baseUrl}}/{{version}}/login",
                    body: {
                        mode: "urlencoded",
                        urlencoded: [{ key: "username", value: "ada" }],
                    },
                },
            },
            {
                name: "Binary",
                request: {
                    method: "POST",
                    url: "{{baseUrl}}/{{version}}/binary",
                    body: { mode: "file", file: { src: "/tmp/file.bin" } },
                },
            },
            {
                name: "GraphQL",
                request: {
                    method: "POST",
                    url: "{{baseUrl}}/{{version}}/graphql",
                    body: {
                        mode: "graphql",
                        graphql: { query: "query User($id: ID!) { user(id: $id) { id } }", variables: "{\"id\":\"u1\"}" },
                    },
                },
            },
        ],
    }, {}, {
        globals: {
            values: [
                { key: "baseUrl", value: "https://global.example.com" },
                { key: "tenant", value: "global-tenant" },
                { key: "traceId", value: "global-trace" },
            ],
        },
        environment: {
            values: [
                { key: "baseUrl", value: "https://env.example.com" },
                { key: "tenant", value: "env-tenant" },
                { key: "token", value: "secret" },
                { key: "traceId", value: "env-trace" },
            ],
        },
        variables: { traceId: "explicit-trace" },
    });

    assert.equal(model.baseUrls[0], "https://env.example.com");
    assert.equal(model.operations.length, 7);
    assert.equal(model.operations.some((operation) => operation.summary === "Hidden"), false);
    assert.equal(model.operations.some((operation) => operation.summary === "Disabled Request"), false);

    const listUsers = model.operations.find((operation) => operation.summary === "List Users");
    assert.ok(listUsers);
    assert.equal(listUsers.path, "/v1/users");
    assert.deepEqual(listUsers.security, [{ bearer: [] }]);
    assert.equal(listUsers.parameters.some((parameter) => parameter.in === "header" && parameter.name === "Authorization"), false);
    assert.equal(listUsers.parameters.find((parameter) => parameter.name === "X-Trace")?.schema?.example, "explicit-trace");
    assert.deepEqual(
        listUsers.parameters.filter((parameter) => parameter.in === "query").map((parameter) => [parameter.name, parameter.schema?.example]),
        [["raw", "true"], ["tenant", "env-tenant"], ["structured", "yes"]]
    );

    const createUser = model.operations.find((operation) => operation.summary === "Create User");
    assert.deepEqual(createUser?.security, []);
    assert.equal(createUser?.requestBody?.content[0].mediaType, "application/json");
    assert.deepEqual(createUser?.requestBody?.content[0].example, { name: "Ada", active: true });

    assert.equal(model.operations.find((operation) => operation.summary === "Update Text")?.requestBody?.content[0].mediaType, "text/plain");
    assert.equal(model.operations.find((operation) => operation.summary === "Upload")?.requestBody?.content[0].mediaType, "multipart/form-data");
    assert.equal(model.operations.find((operation) => operation.summary === "Login")?.requestBody?.content[0].mediaType, "application/x-www-form-urlencoded");
    assert.equal(model.operations.find((operation) => operation.summary === "Binary")?.requestBody?.content[0].mediaType, "application/octet-stream");
    assert.equal(model.operations.find((operation) => operation.summary === "GraphQL")?.requestBody?.content[0].mediaType, "application/json");
});

test("schema generation supports OpenAPI composition keywords", () => {
    assert.equal(
        schemaToZodType({
            oneOf: [{ type: "string" }, { type: "integer" }],
        }),
        "z.union([z.string(), z.number().int()])"
    );
    assert.equal(
        schemaToZodType({
            anyOf: [{ type: "string" }, { type: "boolean" }],
        }),
        "z.union([z.string(), z.boolean()])"
    );
    assert.equal(
        schemaToZodType({
            allOf: [
                { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
                { type: "object", properties: { active: { type: "boolean" } } },
            ],
        }),
        "z.object({\n    \"id\": z.string()\n  }).passthrough().and(z.object({\n    \"active\": z.boolean().optional()\n  }).passthrough())"
    );
});

test("schema generation emits valid Zod for string, numeric, mixed, and single-value enums", () => {
    assert.equal(
        schemaToZodType({ type: "string", enum: ["draft", "published"] }),
        "z.enum([\"draft\", \"published\"])"
    );
    assert.equal(
        schemaToZodType({ type: "integer", enum: [1, 2] }),
        "z.union([z.literal(1), z.literal(2)])"
    );
    assert.equal(
        schemaToZodType({ enum: ["auto", 0, true] }),
        "z.union([z.literal(\"auto\"), z.literal(0), z.literal(true)])"
    );
    assert.equal(
        schemaToZodType({ type: "string", enum: ["only"] }),
        "z.literal(\"only\")"
    );
});
