import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyGeneratedProject } from "./verify.ts";
import type { GeneratedProject } from "./types.ts";

function makeNodeProject(): GeneratedProject {
    return {
        manifest: {
            generatorVersion: "test",
            contractVersion: 2,
            language: "node",
            framework: "mcp-ts-sdk",
            features: {
                documentation: false,
                docker: false,
                tests: true,
                verification: true,
            },
            transport: "http",
            serverName: "full-verify-test",
            generatedAt: "2026-05-29T00:00:00.000Z",
            toolCount: 1,
        },
        files: new Map([
            ["package.json", JSON.stringify({
                name: "full-verify-test",
                version: "1.0.0",
                type: "module",
                scripts: {
                    build: "node -e \"const fs=require('node:fs'); fs.mkdirSync('dist/src/mcp', { recursive: true }); fs.writeFileSync('dist/src/mcp/server.js', 'export {};');\"",
                    test: "node tests/manifest.test.js",
                },
                dependencies: {
                    "@modelcontextprotocol/sdk": "1.32.1",
                },
            }, null, 2)],
            ["tsconfig.json", JSON.stringify({ compilerOptions: {}, include: ["src/**/*"] }, null, 2)],
            ["src/index.ts", ""],
            ["src/config.ts", ""],
            ["src/mcp/server.ts", ""],
            ["src/api/client.ts", ""],
            ["src/api/operations.ts", ""],
            ["src/api/serialization.ts", ""],
            ["tests/manifest.test.js", "import assert from 'node:assert/strict'; assert.equal(1, 1);\n"],
            ["mcpmint.manifest.json", "{}"],
        ]),
    };
}

test("full node verification installs, builds, imports, and runs generated tests", () => {
    const report = verifyGeneratedProject(makeNodeProject(), "full");

    assert.equal(report.status, "passed");
    assert.equal(report.mode, "full");
    assert.deepEqual(report.checks.map((check) => [check.name, check.status]), [
        ["template-artifacts", "passed"],
        ["project-shape", "passed"],
        ["node-npm-install", "passed"],
        ["node-build", "passed"],
        ["node-import", "passed"],
        ["node-tests", "passed"],
    ]);
});

test("full node verification fails when required install command cannot spawn", () => {
    const originalPath = process.env.PATH;
    const emptyPath = mkdtempSync(join(tmpdir(), "mcpmint-empty-path-"));

    try {
        process.env.PATH = emptyPath;
        const report = verifyGeneratedProject(makeNodeProject(), "full");

        assert.equal(report.status, "failed");
        assert.equal(report.mode, "full");
        assert.deepEqual(report.checks.map((check) => [check.name, check.status]), [
            ["template-artifacts", "passed"],
            ["project-shape", "passed"],
            ["node-npm-install", "failed"],
        ]);
    } finally {
        process.env.PATH = originalPath;
        rmSync(emptyPath, { recursive: true, force: true });
    }
});
