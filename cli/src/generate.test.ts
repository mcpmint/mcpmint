import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProjectFiles } from "./generate.ts";

test("forced regeneration replaces generated files and keeps user files", () => {
    const root = mkdtempSync(join(tmpdir(), "mcpmint-force-test-"));
    const outDir = join(root, "server");

    try {
        writeProjectFiles(new Map([
            ["README.md", "old docs"],
            ["obsolete.txt", "remove me"],
        ]), outDir, false);
        writeFileSync(join(outDir, ".env"), "API_KEY=secret");
        mkdirSync(join(outDir, ".git"));
        writeFileSync(join(outDir, ".git", "HEAD"), "ref: refs/heads/main");

        writeProjectFiles(new Map([
            ["README.md", "new docs"],
            ["src/index.ts", "export {};"],
        ]), outDir, true);

        assert.equal(readFileSync(join(outDir, "README.md"), "utf8"), "new docs");
        assert.equal(readFileSync(join(outDir, "src/index.ts"), "utf8"), "export {};");
        assert.equal(existsSync(join(outDir, "obsolete.txt")), false);
        assert.equal(readFileSync(join(outDir, ".env"), "utf8"), "API_KEY=secret");
        assert.equal(existsSync(join(outDir, ".git", "HEAD")), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("non-forced regeneration refuses to mix with existing output", () => {
    const root = mkdtempSync(join(tmpdir(), "mcpmint-no-force-test-"));
    const outDir = join(root, "server");

    try {
        writeProjectFiles(new Map([["old.txt", "old"]]), outDir, false);
        assert.throws(
            () => writeProjectFiles(new Map([["new.txt", "new"]]), outDir, false),
            /is not empty/,
        );
        assert.equal(readFileSync(join(outDir, "old.txt"), "utf8"), "old");
        assert.equal(existsSync(join(outDir, "new.txt")), false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("writer refuses the current directory and its parents", () => {
    assert.throws(
        () => writeProjectFiles(new Map([["README.md", "x"]]), process.cwd(), true),
        /contains the current directory/,
    );
    assert.throws(
        () => writeProjectFiles(new Map([["README.md", "x"]]), join(process.cwd(), ".."), true),
        /contains the current directory/,
    );
});

test("a tampered managed-files list cannot delete files outside the output folder", () => {
    const root = mkdtempSync(join(tmpdir(), "mcpmint-list-test-"));
    const outDir = join(root, "server");

    try {
        writeFileSync(join(root, "keep.txt"), "keep");
        writeProjectFiles(new Map([["README.md", "docs"]]), outDir, false);
        writeFileSync(join(outDir, ".mcpmint-files"), "../keep.txt\n/etc/hosts\nREADME.md\n");
        writeProjectFiles(new Map([["src/index.ts", "export {};"]]), outDir, true);
        assert.equal(readFileSync(join(root, "keep.txt"), "utf8"), "keep");
        assert.equal(existsSync(join(outDir, "README.md")), false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
