import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (result.error) throw result.error;
const report = JSON.parse(result.stdout);
if (report.error) throw new Error(`Dependency audit failed: ${report.error.code}`);
const findings = report.vulnerabilities || {};
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
// Unpatched dev-only ESLint glob parser; see docs/dependency-policy.md.
const chain = new Set(["braces", "micromatch", "fast-glob", "@next/eslint-plugin-next", "eslint-config-next"]);
const exceptionActive = new Date() < new Date("2026-11-06T00:00:00Z");
function excepted(name, seen = new Set()) {
  const finding = findings[name];
  if (!exceptionActive || !chain.has(name) || !finding?.nodes?.every((node) => lock.packages?.[node]?.dev === true) || finding.severity !== "high" || seen.has(name)) return false;
  seen.add(name);
  return finding.via.every((source) => typeof source === "string"
    ? excepted(source, new Set(seen))
    : source.url === "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm");
}
const blocked = Object.keys(findings).filter((name) => !excepted(name));
if (blocked.length) {
  console.error("Untriaged dependency findings:", blocked.join(", "));
  process.exitCode = 1;
} else {
  console.log("Production audit clean. Dev-only exceptions:", Object.keys(findings).join(", ") || "none");
}
