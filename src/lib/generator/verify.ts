import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { GeneratedProject, VerificationCheck, VerificationMode, VerificationReport } from "./types.ts";

const COMMAND_TIMEOUT_MS = Number(process.env.MCPMINT_FULL_VERIFY_TIMEOUT_MS || 120_000);
const MAX_COMMAND_OUTPUT_LENGTH = 6000;

function resolveTypeScriptCompilerPath(): string {
    return fileURLToPath(import.meta.resolve("typescript/lib/tsc.js"));
}

function writeProjectToTempDir(project: GeneratedProject): string {
    const tempDir = mkdtempSync(join(tmpdir(), "mcpmint-project-"));

    for (const [filePath, content] of project.files) {
        const absolutePath = join(tempDir, filePath);
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content, "utf8");
    }

    return tempDir;
}

function truncateOutput(output: string): string {
    const trimmed = output.trim();
    if (trimmed.length <= MAX_COMMAND_OUTPUT_LENGTH) {
        return trimmed;
    }

    return `${trimmed.slice(0, MAX_COMMAND_OUTPUT_LENGTH)}\n... output truncated ...`;
}

function formatCommandFailure(result: SpawnSyncReturns<string>, fallback: string): string {
    if (result.error) {
        return result.error.message;
    }

    return truncateOutput([result.stderr, result.stdout].filter(Boolean).join("\n")) || fallback;
}

function runVerificationCommand(
    name: string,
    command: string,
    args: string[],
    cwd: string,
    fallback: string,
    env?: Partial<NodeJS.ProcessEnv>
): VerificationCheck {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        env: env ? { ...process.env, ...env } : process.env,
        timeout: COMMAND_TIMEOUT_MS,
    });

    if (result.error) {
        return {
            name,
            status: "failed",
            details: formatCommandFailure(result, fallback),
        };
    }

    if (result.status !== 0) {
        return {
            name,
            status: "failed",
            details: formatCommandFailure(result, fallback),
        };
    }

    return { name, status: "passed" };
}

function findPythonBinary(): string {
    for (const candidate of ["python3", "python", "/usr/bin/python3"]) {
        const result = spawnSync(candidate, [
            "-c",
            "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)",
        ], {
            encoding: "utf8",
            timeout: 5000,
        });

        if (!result.error && result.status === 0) {
            return candidate;
        }
    }

    return "python3";
}

function getVenvPythonPath(tempDir: string): string {
    return process.platform === "win32"
        ? join(tempDir, ".venv", "Scripts", "python.exe")
        : join(tempDir, ".venv", "bin", "python");
}

function hasGeneratedTests(project: GeneratedProject): boolean {
    return Array.from(project.files.keys()).some((filePath) => filePath.startsWith("tests/"));
}

// Detect leftover Mustache/Handlebars-style placeholders (e.g. `{{serverName}}`).
// Matches a `{{ ... }}` pair whose body is a placeholder token, not arbitrary adjacent
// braces — emitted code legitimately contains `}}` (nested JSON/dict/object literals),
// which must not be flagged.
const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*[\w.$-]+\s*\}\}/;

function verifyNoTemplateArtifacts(project: GeneratedProject): VerificationCheck {
    for (const [filePath, content] of project.files) {
        if (TEMPLATE_PLACEHOLDER_PATTERN.test(content)) {
            return {
                name: "template-artifacts",
                status: "failed",
                details: `Unresolved template placeholder found in ${filePath}`,
            };
        }
    }

    return { name: "template-artifacts", status: "passed" };
}

function verifyProjectShape(project: GeneratedProject): VerificationCheck {
    const requiredFiles = project.manifest.language === "node"
        ? [
            "package.json",
            "tsconfig.json",
            "src/index.ts",
            "src/config.ts",
            "src/mcp/server.ts",
            "src/api/client.ts",
            "src/api/operations.ts",
            "src/api/serialization.ts",
            "mcpmint.manifest.json",
        ]
        : [
            "pyproject.toml",
            "src/server.py",
            "src/config.py",
            "src/api_client.py",
            "src/operations.py",
            "src/serialization.py",
            "mcpmint.manifest.json",
        ];

    const missing = requiredFiles.filter((filePath) => !project.files.has(filePath));
    if (missing.length > 0) {
        return {
            name: "project-shape",
            status: "failed",
            details: `Missing required files: ${missing.join(", ")}`,
        };
    }

    return { name: "project-shape", status: "passed" };
}

function createNodeVerificationFiles(tempDir: string) {
    const stubsPath = join(tempDir, "verification-stubs.d.ts");
    const configPath = join(tempDir, "tsconfig.verify.json");

    writeFileSync(stubsPath, `interface ImportMeta { dirname: string; }
declare const process: {
  env: Record<string, string | undefined>;
};
declare const Buffer: {
  concat(values: readonly Uint8Array[]): { toString(encoding: string): string; };
  from(value: string, encoding?: string): {
    toString(encoding: string): string;
    length: number;
  };
};

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(config: unknown);
    tool(...args: unknown[]): void;
    registerTool(name: string, config: unknown, handler: (...args: any[]) => unknown): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {}
}

declare module "@modelcontextprotocol/sdk/server/sse.js" {
  export class SSEServerTransport {
    constructor(path: string, response: unknown);
    sessionId: string;
    onclose?: () => void;
    handlePostMessage(request: unknown, response: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/streamableHttp.js" {
  export class StreamableHTTPServerTransport {
    constructor(config: unknown);
    handleRequest(request: unknown, response: unknown): Promise<void>;
  }
}

declare module "zod" {
  export const z: any;
}

declare module "dotenv/config" {}
declare module "dotenv" { export function config(options?: { path: string }): void; }
declare module "node:url" { export function fileURLToPath(url: URL): string; }

declare module "http" {
  const http: {
    createServer: (...args: any[]) => {
      listen: (...listenArgs: any[]) => void;
    };
  };
  export default http;
  export function createServer(...args: any[]): {
    listen: (...listenArgs: any[]) => void;
  };
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(...args: any[]): string;
}

declare module "node:path" {
  export function resolve(...args: any[]): string;
}

declare module "node:crypto" {
  export function timingSafeEqual(a: any, b: any): boolean;
}
`, "utf8");

    writeFileSync(configPath, JSON.stringify({
        extends: "./tsconfig.json",
        compilerOptions: {
            noEmit: true,
            noImplicitAny: false,
        },
        include: ["src/**/*", "tests/**/*", "verification-stubs.d.ts"],
    }, null, 2), "utf8");

    return { configPath };
}

function verifyNodeProject(project: GeneratedProject): VerificationCheck {
    const tempDir = writeProjectToTempDir(project);

    try {
        const packageJson = JSON.parse(readFileSync(join(tempDir, "package.json"), "utf8")) as {
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
        };

        if (!packageJson.scripts?.build) {
            return {
                name: "node-generated-project",
                status: "failed",
                details: "Generated package.json is missing a build script",
            };
        }

        if (!/^\d+\.\d+\.\d+$/.test(packageJson.dependencies?.["@modelcontextprotocol/sdk"] || "")) {
            return {
                name: "node-generated-project",
                status: "failed",
                details: "Generated package.json must pin @modelcontextprotocol/sdk to an exact version",
            };
        }

        const { configPath } = createNodeVerificationFiles(tempDir);
        const tscPath = resolveTypeScriptCompilerPath();
        const result = spawnSync(process.execPath, [tscPath, "--noEmit", "-p", configPath], {
            cwd: tempDir,
            encoding: "utf8",
        });

        if (result.error) {
            return {
                name: "node-generated-project",
                status: "skipped",
                details: result.error.message,
            };
        }

        if (result.status !== 0) {
            return {
                name: "node-generated-project",
                status: "failed",
                details: result.stderr || result.stdout || "Generated TypeScript project failed verification",
            };
        }

        return { name: "node-generated-project", status: "passed" };
    } catch (error) {
        return {
            name: "node-generated-project",
            status: "failed",
            details: error instanceof Error ? error.message : "Node project verification failed",
        };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function verifyNodeProjectFull(project: GeneratedProject): VerificationCheck[] {
    const tempDir = writeProjectToTempDir(project);
    const checks: VerificationCheck[] = [];

    try {
        let packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string> };

        try {
            packageJson = JSON.parse(readFileSync(join(tempDir, "package.json"), "utf8")) as {
                scripts?: Record<string, string>;
                dependencies?: Record<string, string>;
            };
        } catch (error) {
            return [{
                name: "node-package-json",
                status: "failed",
                details: error instanceof Error ? error.message : "Generated package.json could not be read",
            }];
        }

        if (!packageJson.scripts?.build) {
            return [{
                name: "node-package-json",
                status: "failed",
                details: "Generated package.json is missing a build script",
            }];
        }

        if (!/^\d+\.\d+\.\d+$/.test(packageJson.dependencies?.["@modelcontextprotocol/sdk"] || "")) {
            return [{
                name: "node-package-json",
                status: "failed",
                details: "Generated package.json must pin @modelcontextprotocol/sdk to an exact version",
            }];
        }

        checks.push(runVerificationCommand(
            "node-npm-install",
            "npm",
            ["install"],
            tempDir,
            "npm install failed for generated project",
            { npm_config_audit: "false", npm_config_fund: "false" }
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        if (process.env.MCPMINT_AUDIT_GENERATED === "1") {
            checks.push(runVerificationCommand("node-dependency-audit", "npm", ["audit", "--audit-level=low"], tempDir, "Generated Node dependencies have an untriaged advisory"));
            if (checks.at(-1)?.status !== "passed") return checks;
        }

        checks.push(runVerificationCommand(
            "node-build",
            "npm",
            ["run", "build"],
            tempDir,
            "npm run build failed for generated project"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        checks.push(runVerificationCommand(
            "node-import",
            process.execPath,
            ["-e", "import('./dist/src/mcp/server.js')"],
            tempDir,
            "Generated Node server module failed to import"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        if (hasGeneratedTests(project) && packageJson.scripts?.test) {
            checks.push(runVerificationCommand(
                "node-tests",
                "npm",
                ["test"],
                tempDir,
                "Generated Node tests failed"
            ));
        } else {
            checks.push({
                name: "node-tests",
                status: "skipped",
                details: "Generated project does not include a test script",
            });
        }

        return checks;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function createPythonImportStubs(tempDir: string) {
    const srcDir = join(tempDir, "src");

    // `fastmcp` is stubbed as a package so that both `from fastmcp import FastMCP` and
    // `from fastmcp.exceptions import ToolError` resolve during the import smoke test.
    const fastmcpDir = join(srcDir, "fastmcp");
    mkdirSync(fastmcpDir, { recursive: true });
    writeFileSync(join(fastmcpDir, "__init__.py"), `class FastMCP:
    def __init__(self, name):
        self.name = name

    def add_tool(self, tool):
        return tool

    def tool(self, *args, **kwargs):
        def decorator(function):
            return function
        return decorator

    def http_app(self, *args, **kwargs):
        return None

    def run(self, *args, **kwargs):
        return None
`, "utf8");

    writeFileSync(join(fastmcpDir, "exceptions.py"), `class ToolError(Exception):
    pass
`, "utf8");

    const toolsDir = join(fastmcpDir, "tools");
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(join(toolsDir, "__init__.py"), `class FunctionTool:
    @classmethod
    def from_function(cls, function, **kwargs):
        return cls()
`, "utf8");

    // `mcp.types.ToolAnnotations` is imported by the generated server module.
    const mcpDir = join(srcDir, "mcp");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(join(mcpDir, "__init__.py"), "", "utf8");
    writeFileSync(join(mcpDir, "types.py"), `class ToolAnnotations:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
`, "utf8");

    writeFileSync(join(srcDir, "httpx.py"), `class Response:
    headers = {}
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {}


class Client:
    def __init__(self, *args, **kwargs):
        pass

    def request(self, *args, **kwargs):
        return Response()
`, "utf8");

    writeFileSync(join(srcDir, "dotenv.py"), `def load_dotenv(*args, **kwargs):
    return True
`, "utf8");
}

function verifyPythonProject(project: GeneratedProject): VerificationCheck {
    const tempDir = writeProjectToTempDir(project);
    const pythonFiles = Array.from(project.files.keys()).filter((filePath) => filePath.endsWith(".py"));

    try {
        const pyproject = project.files.get("pyproject.toml") || "";
        if (!/["']fastmcp==\d+\.\d+\.\d+["']/.test(pyproject)) {
            return {
                name: "python-generated-project",
                status: "failed",
                details: "Generated pyproject.toml must pin fastmcp to an exact version",
            };
        }

        const pythonBinary = findPythonBinary();
        const result = spawnSync(pythonBinary, [
            "-c",
            [
                "import pathlib",
                "sources = [pathlib.Path(p) for p in __import__('sys').argv[1:]]",
                "for source in sources:",
                "    compile(source.read_text(), str(source), 'exec')",
            ].join("\n"),
            ...pythonFiles,
        ], {
            cwd: tempDir,
            encoding: "utf8",
        });

        if (result.error) {
            return {
                name: "python-generated-project",
                status: "skipped",
                details: result.error.message,
            };
        }

        if (result.status !== 0) {
            return {
                name: "python-generated-project",
                status: "failed",
                details: result.stderr || result.stdout || "Generated Python project failed verification",
            };
        }

        createPythonImportStubs(tempDir);
        const importResult = spawnSync(pythonBinary, [
            "-c",
            [
                "import sys",
                "sys.path.insert(0, 'src')",
                "import server",
            ].join("\n"),
        ], {
            cwd: tempDir,
            encoding: "utf8",
        });

        if (importResult.error) {
            return {
                name: "python-generated-project",
                status: "skipped",
                details: importResult.error.message,
            };
        }

        if (importResult.status !== 0) {
            return {
                name: "python-generated-project",
                status: "failed",
                details: importResult.stderr || importResult.stdout || "Generated Python project failed import smoke test",
            };
        }

        return { name: "python-generated-project", status: "passed" };
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function verifyPythonProjectFull(project: GeneratedProject): VerificationCheck[] {
    const tempDir = writeProjectToTempDir(project);
    const checks: VerificationCheck[] = [];
    const pythonBinary = findPythonBinary();
    const venvPython = getVenvPythonPath(tempDir);
    const testsEnabled = hasGeneratedTests(project);

    try {
        const pyproject = project.files.get("pyproject.toml") || "";
        if (!/["']fastmcp==\d+\.\d+\.\d+["']/.test(pyproject)) {
            return [{
                name: "python-pyproject",
                status: "failed",
                details: "Generated pyproject.toml must pin fastmcp to an exact version",
            }];
        }

        checks.push(runVerificationCommand(
            "python-venv",
            pythonBinary,
            ["-m", "venv", ".venv"],
            tempDir,
            "Python virtual environment creation failed"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        checks.push(runVerificationCommand(
            "python-install",
            venvPython,
            ["-m", "pip", "install", testsEnabled ? ".[test]" : "."],
            tempDir,
            "pip install failed for generated project"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        checks.push(runVerificationCommand(
            "python-compile",
            venvPython,
            ["-m", "compileall", "-q", "src"],
            tempDir,
            "Generated Python sources failed to compile"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        checks.push(runVerificationCommand(
            "python-import",
            venvPython,
            ["-c", "import server"],
            tempDir,
            "Generated Python server module failed to import"
        ));

        if (checks.at(-1)?.status !== "passed") {
            return checks;
        }

        if (testsEnabled) {
            checks.push(runVerificationCommand(
                "python-tests",
                venvPython,
                ["-m", "pytest"],
                tempDir,
                "Generated Python tests failed"
            ));
        } else {
            checks.push({
                name: "python-tests",
                status: "skipped",
                details: "Generated project does not include tests",
            });
        }

        return checks;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

export function verifyGeneratedProject(project: GeneratedProject, mode: VerificationMode = "fast"): VerificationReport {
    const checks: VerificationCheck[] = [];
    checks.push(verifyNoTemplateArtifacts(project));
    checks.push(verifyProjectShape(project));

    if (project.manifest.language === "node") {
        if (mode === "full") {
            checks.push(...verifyNodeProjectFull(project));
        } else {
            checks.push(verifyNodeProject(project));
        }
    } else if (mode === "full") {
        checks.push(...verifyPythonProjectFull(project));
    } else {
        checks.push(verifyPythonProject(project));
    }

    return {
        status: checks.some((check) => check.status === "failed") ? "failed" : "passed",
        mode,
        checks,
    };
}
