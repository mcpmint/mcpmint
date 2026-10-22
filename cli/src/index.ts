#!/usr/bin/env node
// mcpmint CLI — generate MCP servers from OpenAPI/Postman specs, locally.
// Your spec never leaves your machine: everything runs in this process.

import { readFileSync, existsSync, readdirSync, watch, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseOpenAPIFromContent } from "../../src/lib/parsers/openapi.ts";
import { buildGeneratorRequest, type BuildRequestOptions } from "./build-request.ts";
import { generateProject, writeProjectFiles } from "./generate.ts";
import { inspectSpec } from "./inspect.ts";
import { analyzeCapabilities, type SelectionPreset } from "../../src/lib/capabilities.ts";
import { createRequestAttestation, formatScan, scanRequest, testRequest } from "./workflows.ts";
import { createTarGzip } from "./tar.ts";

const VERSION = "0.1.0";

const HELP = `mcpmint ${VERSION}
Generate MCP servers from OpenAPI and Postman specs — locally, in your terminal.
Your spec never leaves your machine.

USAGE
  mcpmint generate <spec> [options]
  mcpmint inspect  <spec>
  mcpmint capabilities <spec>
  mcpmint scan <spec> [--attestation <file>]
  mcpmint test <spec> --operation <id> [--args <json>] [--live --allow-mutation]
  mcpmint --help | --version

  <spec> is a path to an OpenAPI/Swagger (JSON or YAML) or Postman collection file.

GENERATE OPTIONS
  --lang <node|python>          Target language              (default: node)
  --transport <stdio|http|sse>  MCP transport                (default: stdio)
  --out <dir>                   Output directory             (default: ./<server-name>)
  --name <name>                 Server name                  (default: derived from spec title)
  --compact                     Emit 3 meta-tools instead of one tool per endpoint
  --preset <recommended|read-only|crud|all-supported>  Endpoint selection
  --operation <id>              Select one operation (repeatable; overrides preset)
  --tag <tag>                   Keep operations with this tag (repeatable)
  --method <verb>               Keep operations with this HTTP method (repeatable)
  --package-manager <npm|pnpm|yarn>  Node package manager    (default: npm)
  --host <host>                 HTTP/SSE bind host           (default: localhost)
  --port <port>                 HTTP/SSE port                (default: 8080)
  --verify <off|fast|full>      Verify generated output      (default: fast)
  --no-tests                    Skip generated smoke tests
  --no-docs                     Skip README/docs
  --docker                      Include Dockerfile + compose
  --force                       Write into a non-empty output directory (keeps your files)
  --accept-risk                 Allow generation when Trust Scan verdict is red
  --attestation <file>          Write the Trust Scan attestation JSON
  --mcp-auth <none|bearer>      Protect HTTP/SSE MCP access (default: none)
  --origin <url>                Allowed browser origin (repeatable)
  --config <file>               Read defaults from a JSON config file
  --dry-run                     Print the generation plan; write nothing
  --format <dir|tar>            Directory or deterministic tar.gz packaging
  --stdout                      Write tar.gz bytes to stdout (implies --format tar)
  --watch                       Regenerate atomically when the spec changes

EXAMPLES
  mcpmint inspect ./petstore.json
  mcpmint generate ./petstore.json --lang python --transport http --out ./petstore-mcp
  mcpmint generate ./api.yaml --compact --verify full
`;

function fail(message: string): never {
    process.stderr.write(`mcpmint: ${message}\n`);
    process.exit(1);
}

async function loadSpec(specPath: string) {
    const resolved = resolve(specPath);
    if (!existsSync(resolved)) fail(`spec file not found: ${specPath}`);
    let content: string;
    try {
        content = readFileSync(resolved, "utf8");
    } catch (error) {
        fail(`could not read ${specPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return await parseOpenAPIFromContent(content, basename(resolved));
    } catch (error) {
        fail(error instanceof Error ? error.message : "failed to parse spec");
    }
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string, fallback: T): T {
    if (value === undefined) return fallback;
    if (!(allowed as readonly string[]).includes(value)) {
        fail(`--${flag} must be one of: ${allowed.join(", ")} (got "${value}")`);
    }
    return value as T;
}

interface CliConfig {
    lang?: string; transport?: string; out?: string; name?: string; compact?: boolean;
    packageManager?: string; host?: string; port?: number; verify?: string;
    tests?: boolean; docs?: boolean; docker?: boolean; force?: boolean;
    preset?: string; operations?: string[]; tags?: string[]; methods?: string[];
    acceptRisk?: boolean; attestation?: string; mcpAuth?: string; origins?: string[];
    dryRun?: boolean; format?: string;
}

function loadCliConfig(path: string | undefined): CliConfig {
    if (!path) return {};
    try {
        const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("--config must contain a JSON object");
        return parsed as CliConfig;
    } catch (error) {
        fail(`could not read --config: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function runGenerate(specPath: string, rawArgs: string[]) {
    const { values } = parseArgs({
        args: rawArgs,
        options: {
            lang: { type: "string" },
            transport: { type: "string" },
            out: { type: "string" },
            name: { type: "string" },
            compact: { type: "boolean" },
            "package-manager": { type: "string" },
            host: { type: "string" },
            port: { type: "string" },
            verify: { type: "string" },
            "no-tests": { type: "boolean" },
            "no-docs": { type: "boolean" },
            docker: { type: "boolean" },
            force: { type: "boolean" },
            preset: { type: "string" },
            operation: { type: "string", multiple: true },
            tag: { type: "string", multiple: true },
            method: { type: "string", multiple: true },
            "accept-risk": { type: "boolean" },
            attestation: { type: "string" },
            "mcp-auth": { type: "string" },
            origin: { type: "string", multiple: true },
            config: { type: "string" },
            "dry-run": { type: "boolean" },
            format: { type: "string" },
            stdout: { type: "boolean" },
            watch: { type: "boolean" },
        },
        allowPositionals: false,
    });
    const config = loadCliConfig(values.config);

    const spec = await loadSpec(specPath);
    if (spec.endpoints.length === 0) fail("no supported endpoints found in the spec");

    const portNum = values.port ? Number(values.port) : config.port ?? 8080;
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        fail(`--port must be an integer between 1 and 65535 (got "${values.port}")`);
    }

    const options: BuildRequestOptions = {
        language: oneOf(values.lang ?? config.lang, ["node", "python"] as const, "lang", "node"),
        transport: oneOf(values.transport ?? config.transport, ["stdio", "http", "sse"] as const, "transport", "stdio"),
        packageManager: oneOf(values["package-manager"] ?? config.packageManager, ["npm", "pnpm", "yarn"] as const, "package-manager", "npm"),
        compactMode: values.compact ?? config.compact ?? false,
        name: values.name ?? config.name,
        host: values.host ?? config.host ?? "localhost",
        port: portNum,
        verificationMode: (values.verify ?? config.verify) === "full" ? "full" : "fast",
        features: {
            documentation: values["no-docs"] !== undefined ? !values["no-docs"] : config.docs ?? true,
            docker: values.docker ?? config.docker ?? false,
            tests: values["no-tests"] !== undefined ? !values["no-tests"] : config.tests ?? true,
            verification: (values.verify ?? config.verify) !== "off",
        },
        selectionPreset: oneOf(values.preset ?? config.preset, ["recommended", "read-only", "crud", "all-supported"] as const, "preset", "all-supported") as SelectionPreset,
        selectedOperationIds: values.operation ?? config.operations,
        selectedTags: values.tag ?? config.tags,
        selectedMethods: values.method ?? config.methods,
        mcpServerAuthType: oneOf(values["mcp-auth"] ?? config.mcpAuth, ["none", "bearer"] as const, "mcp-auth", "none"),
        allowedOrigins: values.origin ?? config.origins,
    };

    const verify = oneOf(values.verify ?? config.verify, ["off", "fast", "full"] as const, "verify", "fast");
    const outputFormat = oneOf(values.stdout ? "tar" : values.format ?? config.format, ["dir", "tar"] as const, "format", "dir");
    const dryRun = values["dry-run"] ?? config.dryRun ?? false;
    const acceptRisk = values["accept-risk"] ?? config.acceptRisk ?? false;
    const diagnostics = values.stdout ? process.stderr : process.stdout;

    let request;
    try {
        request = buildGeneratorRequest(spec, options);
    } catch (error) {
        fail(error instanceof Error ? error.message : "failed to build generation request");
    }
    if (request.tools.length === 0) fail("the selected preset/operations produced no tools");
    const scan = scanRequest(request);
    diagnostics.write(`\n${formatScan(scan.report)}\n`);
    const configuredOut = values.out ?? config.out;
    const outDir = resolve(configuredOut || request.serverConfig.name);
    const replaceExisting = values.force ?? config.force ?? false;
    if (dryRun) {
        const preview = generateProject(request, "off");
        diagnostics.write(`${JSON.stringify({
            dryRun: true,
            source: resolve(specPath),
            output: values.stdout ? "stdout" : outputFormat === "tar" ? `${outDir}.tar.gz` : outDir,
            server: request.serverConfig,
            runtime: request.exportConfig,
            selectedOperations: request.tools.map((tool) => tool.endpointId),
            files: [...preview.files.keys()].sort(),
            warnings: preview.warnings,
            trust: { verdict: scan.report.verdict, score: scan.report.score, findings: scan.report.findings.length, downloadBlocked: scan.report.verdict === "red" && !acceptRisk },
        }, null, 2)}\n`);
        return;
    }
    if (scan.report.verdict === "red" && !acceptRisk) {
        fail("Trust Scan is red. Review findings, then rerun with --accept-risk if the risk is intentional.");
    }
    const attestationPath = values.attestation ?? config.attestation;
    if (attestationPath) {
        writeFileSync(resolve(attestationPath), await createRequestAttestation(request, resolve(specPath), acceptRisk), "utf8");
    }
    if (values.watch && outputFormat !== "dir") fail("--watch currently requires --format dir");
    if (outputFormat === "dir" && existsSync(outDir) && readdirSync(outDir).length > 0 && !replaceExisting) {
        fail(`output directory "${outDir}" is not empty. Use --force to overwrite.`);
    }

    let result;
    try {
        result = generateProject(request, verify);
    } catch (error) {
        fail(error instanceof Error ? error.message : "generation failed");
    }

    // Check before writing, so a failed check never replaces working output.
    if (result.verification) {
        const { status, mode, checks } = result.verification;
        diagnostics.write(`\n  Verification (${mode}): ${status}\n`);
        for (const check of checks) {
            const mark = check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : "skip";
            diagnostics.write(`    [${mark}] ${check.name}${check.details ? ` — ${check.details}` : ""}\n`);
        }
        if (status === "failed") {
            process.stderr.write(`\n  Generated output failed verification. Nothing was written.\n`);
            process.exit(2);
        }
    }

    const destination = values.stdout ? "stdout" : outputFormat === "tar" ? (configuredOut ? outDir : `${outDir}.tar.gz`) : outDir;
    try {
        if (outputFormat === "dir") writeProjectFiles(result.files, outDir, replaceExisting);
        else if (values.stdout) process.stdout.write(createTarGzip(result.files));
        else writeFileSync(destination, createTarGzip(result.files));
    } catch (error) {
        fail(error instanceof Error ? error.message : "could not write output");
    }

    diagnostics.write(`\n  Generated ${result.fileCount} files to ${destination}\n`);
    diagnostics.write(
        `  ${request.exportConfig.language} · ${request.serverConfig.transport} · ` +
            `${options.compactMode ? "compact (3 meta-tools)" : `${request.tools.length} tools`}\n`,
    );

    if (result.warnings.length > 0) {
        diagnostics.write(`\n  Warnings:\n`);
        for (const warning of result.warnings.slice(0, 10)) {
            diagnostics.write(`    - ${warning}\n`);
        }
        if (result.warnings.length > 10) {
            diagnostics.write(`    ... and ${result.warnings.length - 10} more\n`);
        }
    }

    if (outputFormat === "dir") diagnostics.write(`\n  Next: cd ${outDir} && see README.md\n\n`);
    if (values.watch) watchSpec(resolve(specPath), diagnostics);
}

// Editors often save by writing a new file and renaming it over the old one,
// so watch the folder and filter by name. Run one regeneration at a time and
// keep at most one pending run, so an older run never overwrites newer output.
function watchSpec(specFile: string, diagnostics: NodeJS.WritableStream) {
    diagnostics.write(`\n  Watching ${specFile} for changes…\n`);
    const args = process.argv.slice(1).filter((argument) => argument !== "--watch");
    if (!args.includes("--force")) args.push("--force");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let pending = false;

    const regenerate = () => {
        if (running) {
            pending = true;
            return;
        }
        running = true;
        const child = spawn(process.execPath, args, { stdio: "inherit" });
        child.on("exit", (code) => {
            if (code === 0) diagnostics.write("  Regeneration complete.\n");
            else diagnostics.write(`  Regeneration failed with exit code ${code ?? "unknown"}.\n`);
            running = false;
            if (pending) {
                pending = false;
                regenerate();
            }
        });
    };

    watch(dirname(specFile), (_event, filename) => {
        if (filename !== basename(specFile)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(regenerate, 250);
    });
}

async function runInspect(specPath: string) {
    const spec = await loadSpec(specPath);
    process.stdout.write(`\n${inspectSpec(spec)}\n\n`);
}

async function runCapabilities(specPath: string) {
    const spec = await loadSpec(specPath);
    if (!spec.apiModel) fail("canonical API model unavailable");
    const report = analyzeCapabilities(spec.apiModel);
    process.stdout.write(`\nCapabilities: ${report.supported} ready · ${report.manualReview} manual review · ${report.unsupported} unsupported · ${report.recommended} recommended\n`);
    for (const item of report.operations) {
        process.stdout.write(`  [${item.status}] ${item.method} ${item.path} · ${item.risk} risk · ${item.auth} auth${item.reasons.length ? ` — ${item.reasons.join("; ")}` : ""}\n`);
    }
    process.stdout.write("\n");
}

async function runScan(specPath: string, rawArgs: string[]) {
    const { values } = parseArgs({ args: rawArgs, options: { attestation: { type: "string" }, "accept-risk": { type: "boolean", default: false } }, allowPositionals: false });
    const spec = await loadSpec(specPath);
    const request = buildGeneratorRequest(spec, {
        language: "node", transport: "stdio", packageManager: "npm", compactMode: false,
        host: "localhost", port: 8080, verificationMode: "fast",
        features: { documentation: true, docker: false, tests: true, verification: false },
    });
    const scan = scanRequest(request);
    process.stdout.write(`\n${formatScan(scan.report)}\n\n`);
    if (values.attestation) writeFileSync(resolve(values.attestation), await createRequestAttestation(request, resolve(specPath), Boolean(values["accept-risk"])), "utf8");
    if (scan.report.verdict === "red" && !values["accept-risk"]) process.exitCode = 2;
}

async function runTest(specPath: string, rawArgs: string[]) {
    const { values } = parseArgs({ args: rawArgs, options: { operation: { type: "string" }, args: { type: "string" }, live: { type: "boolean", default: false }, "allow-mutation": { type: "boolean", default: false } }, allowPositionals: false });
    if (!values.operation) fail("test requires --operation <id>");
    const spec = await loadSpec(specPath);
    const request = buildGeneratorRequest(spec, {
        language: "node", transport: "stdio", packageManager: "npm", compactMode: false,
        host: "localhost", port: 8080, verificationMode: "fast",
        features: { documentation: true, docker: false, tests: true, verification: false },
        selectedOperationIds: [values.operation],
    });
    let args: Record<string, unknown> | undefined;
    if (values.args) {
        try { args = JSON.parse(values.args) as Record<string, unknown>; } catch { fail("--args must be a JSON object"); }
    }
    const result = await testRequest({ request, operationId: values.operation, args, live: Boolean(values.live), allowMutation: Boolean(values["allow-mutation"]) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
    const argv = process.argv.slice(2);

    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
        process.stdout.write(HELP);
        return;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
        process.stdout.write(`${VERSION}\n`);
        return;
    }

    const command = argv[0];
    const rest = argv.slice(1);

    if (["generate", "inspect", "capabilities", "scan", "test"].includes(command)) {
        const specPath = rest[0];
        if (!specPath || specPath.startsWith("-")) fail(`${command} requires a <spec> file path`);
        if (command === "generate") await runGenerate(specPath, rest.slice(1));
        else if (command === "inspect") await runInspect(specPath);
        else if (command === "capabilities") await runCapabilities(specPath);
        else if (command === "scan") await runScan(specPath, rest.slice(1));
        else await runTest(specPath, rest.slice(1));
        return;
    }

    fail(`unknown command "${command}". Run "mcpmint --help".`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
