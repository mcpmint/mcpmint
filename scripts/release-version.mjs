#!/usr/bin/env node
// Keep the three release-version sites in lockstep:
//   1. cli/package.json        "version"
//   2. pypi/pyproject.toml     version = "..."
//   3. pypi/src/mcpmint/__init__.py  __version__ = "..."
//
// The PyPI wrapper executes `npx @mcpmint/cli@<__version__>`, so these MUST match —
// a drifted wrapper would silently run a different generator than it claims.
//
// Usage:
//   node scripts/release-version.mjs --check 0.2.0   # verify all three equal 0.2.0 (CI)
//   node scripts/release-version.mjs --set 0.2.0     # rewrite all three to 0.2.0
//   node scripts/release-version.mjs --current       # print the current (consistent) version

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const sites = [
    {
        file: "cli/package.json",
        read: (text) => JSON.parse(text).version,
        write: (text, version) =>
            text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`),
    },
    {
        // npm records the package version in the lockfile too (top level and
        // under packages[""]); keep both in step so `npm ci` sees no drift.
        file: "cli/package-lock.json",
        read: (text) => {
            const lock = JSON.parse(text);
            const rootEntry = lock.packages?.[""]?.version;
            return lock.version === rootEntry ? lock.version : undefined;
        },
        write: (text, version) => {
            const lock = JSON.parse(text);
            lock.version = version;
            if (lock.packages?.[""]) lock.packages[""].version = version;
            return `${JSON.stringify(lock, null, 2)}\n`;
        },
    },
    {
        file: "pypi/pyproject.toml",
        read: (text) => text.match(/^version = "([^"]+)"/m)?.[1],
        write: (text, version) =>
            text.replace(/^version = "[^"]+"/m, `version = "${version}"`),
    },
    {
        file: "pypi/src/mcpmint/__init__.py",
        read: (text) => text.match(/^__version__ = "([^"]+)"/m)?.[1],
        write: (text, version) =>
            text.replace(/^__version__ = "[^"]+"/m, `__version__ = "${version}"`),
    },
];

function fail(message) {
    console.error(`release-version: ${message}`);
    process.exit(1);
}

function currentVersions() {
    return sites.map((site) => {
        const text = readFileSync(join(root, site.file), "utf8");
        const version = site.read(text);
        if (!version) fail(`could not find a version in ${site.file}`);
        return { file: site.file, version, text };
    });
}

const [mode, argVersion] = process.argv.slice(2);

if (mode === "--current") {
    const versions = currentVersions();
    const unique = new Set(versions.map((entry) => entry.version));
    if (unique.size !== 1) {
        for (const entry of versions) console.error(`  ${entry.file}: ${entry.version}`);
        fail("version sites are OUT OF SYNC");
    }
    console.log(versions[0].version);
    process.exit(0);
}

if (mode === "--check") {
    if (!argVersion || !SEMVER.test(argVersion)) fail(`--check needs a semver version (got "${argVersion || ""}")`);
    const mismatches = currentVersions().filter((entry) => entry.version !== argVersion);
    if (mismatches.length > 0) {
        for (const entry of mismatches) {
            console.error(`  ${entry.file}: ${entry.version} (expected ${argVersion})`);
        }
        fail("version sites do not match the release version");
    }
    console.log(`all version sites = ${argVersion}`);
    process.exit(0);
}

if (mode === "--set") {
    if (!argVersion || !SEMVER.test(argVersion)) fail(`--set needs a semver version (got "${argVersion || ""}")`);
    for (const site of sites) {
        const path = join(root, site.file);
        const text = readFileSync(path, "utf8");
        const updated = site.write(text, argVersion);
        if (site.read(updated) !== argVersion) fail(`rewrite failed for ${site.file}`);
        writeFileSync(path, updated);
        console.log(`  ${site.file} -> ${argVersion}`);
    }
    console.log(`\nNow: commit, push, then tag the release:\n  git tag v${argVersion} && git push --tags`);
    process.exit(0);
}

fail('usage: release-version.mjs --check <version> | --set <version> | --current');
