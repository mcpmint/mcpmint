import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// verify.ts resolves typescript/lib/tsc.js at runtime, so a production install
// of the CLI must include it.
test("packages that verification loads at runtime are runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const verify = readFileSync(new URL("../../src/lib/generator/verify.ts", import.meta.url), "utf8");
    for (const [, name] of verify.matchAll(/import\.meta\.resolve\("([^"/]+)/g)) {
        assert.ok(pkg.dependencies?.[name], `${name} must be in cli dependencies`);
    }
});
