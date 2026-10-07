import { FASTMCP_VERSION, NODE_MCP_SDK_VERSION } from "./runtime-versions.ts";
import type { GeneratedManifest, GenerationPlan } from "./types.ts";

interface Component {
  type: "library";
  name: string;
  version: string;
  purl: string;
  scope: "required" | "optional";
}

const NODE_RUNTIME_VERSION = "22.17.0";
const PYTHON_RUNTIME_VERSION = "3.11.13";

function components(plan: GenerationPlan): Component[] {
  if (plan.runtime.language === "node") {
    return [
      { type: "library", name: "@modelcontextprotocol/sdk", version: NODE_MCP_SDK_VERSION, purl: `pkg:npm/%40modelcontextprotocol/sdk@${NODE_MCP_SDK_VERSION}`, scope: "required" },
      { type: "library", name: "dotenv", version: "16.4.7", purl: "pkg:npm/dotenv@16.4.7", scope: "required" },
      { type: "library", name: "zod", version: "3.25.76", purl: "pkg:npm/zod@3.25.76", scope: "required" },
      { type: "library", name: "@types/node", version: "20.19.43", purl: "pkg:npm/%40types/node@20.19.43", scope: "optional" },
      { type: "library", name: "tsx", version: "4.23.15", purl: "pkg:npm/tsx@4.23.15", scope: "optional" },
      { type: "library", name: "typescript", version: "5.9.3", purl: "pkg:npm/typescript@5.9.3", scope: "optional" },
    ];
  }
  return [
    { type: "library", name: "fastmcp", version: FASTMCP_VERSION, purl: `pkg:pypi/fastmcp@${FASTMCP_VERSION}`, scope: "required" },
    { type: "library", name: "jsonschema", version: "4.26.0", purl: "pkg:pypi/jsonschema@4.26.0", scope: "required" },
    { type: "library", name: "httpx", version: "0.28.1", purl: "pkg:pypi/httpx@0.28.1", scope: "required" },
    { type: "library", name: "python-dotenv", version: "1.1.0", purl: "pkg:pypi/python-dotenv@1.1.0", scope: "required" },
    ...(plan.runtime.transport === "stdio" ? [] : [
      { type: "library" as const, name: "uvicorn", version: "0.35.0", purl: "pkg:pypi/uvicorn@0.35.0", scope: "required" as const },
      { type: "library" as const, name: "starlette", version: "1.0.1", purl: "pkg:pypi/starlette@1.0.1", scope: "required" as const },
    ]),
    ...(plan.features.tests ? [{ type: "library" as const, name: "pytest", version: "8.0.0", purl: "pkg:pypi/pytest@8.0.0", scope: "optional" as const }] : []),
  ];
}

export function renderDependencyLock(plan: GenerationPlan): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    scope: "direct-dependencies-only",
    packageManagerEnforced: false,
    note: "Install and commit a package-manager lockfile to resolve and lock transitive dependencies.",
    generatedBy: `mcpmint@${plan.generatorVersion}`,
    runtime: plan.runtime.language === "node"
      ? { name: "node", version: NODE_RUNTIME_VERSION }
      : { name: "python", version: PYTHON_RUNTIME_VERSION },
    dependencies: components(plan).map(({ name, version, purl, scope }) => ({ name, version, purl, scope })),
    updateCheck: plan.runtime.language === "node" ? "npm outdated" : "python -m pip list --outdated",
  }, null, 2)}\n`;
}

export function renderLicenseSummary(plan: GenerationPlan): string {
  const licenses = plan.runtime.language === "node"
    ? [["@modelcontextprotocol/sdk", "MIT"], ["dotenv", "BSD-2-Clause"], ["zod", "MIT"], ["tsx", "MIT"], ["typescript", "Apache-2.0"]]
    : [["jsonschema", "MIT"], ["fastmcp", "Apache-2.0"], ["httpx", "BSD-3-Clause"], ["python-dotenv", "BSD-3-Clause"], ...(plan.runtime.transport === "stdio" ? [] : [["uvicorn", "BSD-3-Clause"], ["starlette", "BSD-3-Clause"]])];
  return `# Third-party license summary\n\nGenerated from mcpmint's pinned direct dependency set. Verify transitive licenses in CI before redistribution.\n\n| Dependency | License |\n| --- | --- |\n${licenses.map(([name, license]) => `| ${name} | ${license} |`).join("\n")}\n`;
}

export function renderDependabot(plan: GenerationPlan): string {
  const ecosystem = plan.runtime.language === "node" ? "npm" : "pip";
  return `version: 2\nupdates:\n  - package-ecosystem: ${ecosystem}\n    directory: "/"\n    schedule:\n      interval: weekly\n    open-pull-requests-limit: 5\n`;
}

export function runtimePin(plan: GenerationPlan): { name: string; content: string } {
  return plan.runtime.language === "node"
    ? { name: ".nvmrc", content: `${NODE_RUNTIME_VERSION}\n` }
    : { name: ".python-version", content: `${PYTHON_RUNTIME_VERSION}\n` };
}

export function renderSbom(plan: GenerationPlan): string {
  return `${JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: plan.generatedAt,
      properties: [{ name: "mcpmint:scope", value: "direct dependencies only; verify transitive inventory after installation" }],
      tools: [{ vendor: "mcpmint", name: "mcpmint", version: plan.generatorVersion }],
      component: { type: "application", name: plan.server.name, version: plan.server.version },
    },
    components: components(plan),
  }, null, 2)}\n`;
}

export function renderProvenance(plan: GenerationPlan, manifest: GeneratedManifest): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    predicateType: "https://mcpmint.dev/generation-record/v1",
    signed: false,
    note: "Self-reported generator metadata. Not an independently verified or signed build provenance statement.",
    subject: { name: plan.server.name, version: plan.server.version },
    buildDefinition: {
      buildType: "https://mcpmint.dev/build/v1",
      externalParameters: {
        source: { title: plan.spec.title, version: plan.spec.version, baseUrl: plan.spec.baseUrl },
        language: plan.runtime.language,
        framework: plan.runtime.framework,
        transport: plan.runtime.transport,
        compactMode: plan.runtime.compactMode,
        operationIds: plan.tools.map((tool) => tool.id),
      },
      resolvedDependencies: components(plan).map(({ name, version, purl }) => ({ name, version, purl })),
    },
    runDetails: {
      builder: { id: `mcpmint@${plan.generatorVersion}` },
      metadata: { invocationId: `${plan.server.name}@${plan.generatedAt}`, startedOn: plan.generatedAt },
    },
    manifest,
    reproducibility: {
      command: "Re-run mcpmint with the same source spec, operation selection, and export configuration.",
      note: "Timestamps and invocation IDs are expected to differ; dependency constraints and operation IDs should match.",
    },
  }, null, 2)}\n`;
}
