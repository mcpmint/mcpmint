import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAPIFromContent, buildValidationSummary } from "./openapi.ts";
import { resolveLocalReferences } from "./local-references.ts";
import {
  assertGraphBudget,
  assertTextSize,
  assertSpecFile,
  MAX_SPEC_BYTES,
} from "../processing/limits.ts";

test("recursive JSON Schema references remain finite through import and validation", async () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Recursive", version: "1" },
    paths: {
      "/nodes": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Node" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: "object",
          properties: { child: { $ref: "#/components/schemas/Node" } },
        },
      },
    },
  };
  const result = await parseOpenAPIFromContent(
    JSON.stringify(spec),
    "recursive.json",
  );
  assert.equal(result.endpoints.length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.doesNotThrow(() => buildValidationSummary(result));
  assert.match(JSON.stringify(result), /\$ref/);
});
test("external and missing references fail without network access", () => {
  assert.throws(
    () =>
      resolveLocalReferences({
        schema: { $ref: "https://example.com/private-schema.json" },
      }),
    /External references are not fetched/,
  );
  assert.throws(
    () => resolveLocalReferences({ schema: { $ref: "#/missing" } }),
    /not found/,
  );
  const result = resolveLocalReferences({
    schemas: { "a/b~c": { type: "string" } },
    schema: { $ref: "#/schemas/a~1b~0c" },
  });
  assert.deepEqual(result.schema, { type: "string" });
});
test("all entry points enforce UTF-8 sizes, file types and graph budgets", async () => {
  assert.throws(
    () => assertTextSize("é".repeat(MAX_SPEC_BYTES / 2 + 1)),
    /larger than 5 MB/,
  );
  await assert.rejects(
    parseOpenAPIFromContent(" ".repeat(MAX_SPEC_BYTES + 1), "paste"),
    /larger than 5 MB/,
  );
  assert.throws(
    () => assertSpecFile({ name: "spec.pdf", size: 20 }),
    /JSON\/YAML/,
  );
  assert.throws(
    () => assertSpecFile({ name: "spec.json", size: MAX_SPEC_BYTES + 1 }),
    /larger than 5 MB/,
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => assertGraphBudget(circular), /Circular object aliases/);
  let deep: unknown = {};
  for (let i = 0; i < 70; i++) deep = { child: deep };
  assert.throws(() => assertGraphBudget(deep), /deeply nested/);
});

test("imports reject operation catalogs above the shared workload limit", async () => {
  const paths = Object.fromEntries(
    Array.from({ length: 10_001 }, (_, i) => [
      `/items/${i}`,
      { get: { responses: { "200": { description: "OK" } } } },
    ]),
  );
  await assert.rejects(
    parseOpenAPIFromContent(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Oversized catalog", version: "1" },
        paths,
      }),
      "catalog.json",
    ),
    /10,000 operations/,
  );
});
