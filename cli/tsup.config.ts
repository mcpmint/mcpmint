import { defineConfig } from "tsup";

// Bundle the CLI + the pure generator/parser core into a single ESM file.
// Runtime node_modules deps stay external (declared in package.json).
// The @modelcontextprotocol/sdk import in the Node target is `import type`
// only (erased at build), but we mark it external as belt-and-suspenders.
export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node22",
    platform: "node",
    clean: true,
    minify: false,
    external: ["@apidevtools/swagger-parser", "yaml", "zod", "@modelcontextprotocol/sdk"],
});
