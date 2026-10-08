import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

test("the public generation route stays outside process-spawning verification", () => {
    const route = readFileSync(join(directory, "../../app/api/generate/route.ts"), "utf8");
    const server = readFileSync(join(directory, "server.ts"), "utf8");

    assert.match(route, /@\/lib\/generator\/server/);
    assert.doesNotMatch(route, /@\/lib\/generator["']/);
    assert.doesNotMatch(server, /from ["']\.\/verify|node:child_process/);
});

test("browser compression stays inside a dedicated worker without nested blob workers", () => {
    const generator = readFileSync(join(directory, "../client-generate.ts"), "utf8");
    const worker = readFileSync(join(directory, "../processing/task.worker.ts"), "utf8");
    const client = readFileSync(join(directory, "../processing/client.ts"), "utf8");
    const page = readFileSync(join(directory, "../../app/export/page.tsx"), "utf8");
    assert.match(generator, /import \{ zipSync, strToU8 \} from ["']fflate["']/);
    assert.match(worker, /await import\("\.\.\/client-generate"\)/);
    assert.match(client, /new Worker\(new URL/);
    assert.match(client, /worker\.terminate\(\)/);
    assert.doesNotMatch(page, /import \{ generateProjectInBrowser/);
});
