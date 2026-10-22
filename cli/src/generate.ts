// Generate a project to disk from a GeneratorRequest.
//
// Imports the granular generator pieces directly (not ../../src/lib/generator
// index, which pulls in archiver via archive.ts) — same approach the browser
// path takes. Post-generation verification IS available here (unlike the
// browser), since the CLI can shell out to tsc / npm / python locally.

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { GeneratorRequest, VerificationReport } from "../../src/lib/generator/types.ts";
import { buildGenerationPlan } from "../../src/lib/generator/normalize.ts";
import { validateGenerationPlan } from "../../src/lib/generator/validate.ts";
import { generateNodeProject } from "../../src/lib/generator/targets/node.ts";
import { generatePythonProject } from "../../src/lib/generator/targets/python.ts";
import { verifyGeneratedProject } from "../../src/lib/generator/verify.ts";

export interface GenerateResult {
    fileCount: number;
    files: ReadonlyMap<string, string>;
    warnings: string[];
    verification?: VerificationReport;
}

export function generateProject(
    request: GeneratorRequest,
    verify: "off" | "fast" | "full",
): GenerateResult {
    const plan = buildGenerationPlan(request);
    const validation = validateGenerationPlan(plan);
    if (validation.errors.length > 0) {
        throw new Error(validation.errors.map((error) => error.message).join("\n"));
    }
    const project = plan.runtime.language === "node" ? generateNodeProject(plan) : generatePythonProject(plan);
    const verification = verify !== "off" ? verifyGeneratedProject(project, verify) : undefined;
    return { fileCount: project.files.size, files: project.files, warnings: plan.warnings, verification };
}

// The list of files the last run wrote. A forced run deletes only files on this
// list that the new run no longer makes, so user files such as .env stay.
const MANAGED_FILES_LIST = ".mcpmint-files";

function isSafeRelativePath(filePath: string): boolean {
    const normalized = normalize(filePath);
    return filePath !== "" && normalized !== "." && !isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function readManagedFiles(outDir: string): string[] {
    try {
        return readFileSync(join(outDir, MANAGED_FILES_LIST), "utf8").split("\n").filter(isSafeRelativePath);
    } catch {
        return [];
    }
}

function containsPath(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function writeProjectFiles(
    files: ReadonlyMap<string, string>,
    outDir: string,
    replaceExisting: boolean,
): void {
    const target = resolve(outDir);
    if (containsPath(target, process.cwd())) {
        throw new Error(`refusing to write into "${target}" because it contains the current directory. Choose a separate --out folder.`);
    }
    if (existsSync(target) && readdirSync(target).length > 0 && !replaceExisting) {
        throw new Error(`output directory "${target}" is not empty`);
    }

    const parentDirectory = dirname(target);
    mkdirSync(parentDirectory, { recursive: true });
    const previous = readManagedFiles(target);
    const output = new Map(files);
    output.set(MANAGED_FILES_LIST, `${[...files.keys()].sort().join("\n")}\n`);

    // Write everything to a staging folder first, so a write error leaves the
    // existing output untouched. Then move each file into place.
    const stagingDirectory = mkdtempSync(join(parentDirectory, `.${basename(target)}-mcpmint-`));
    try {
        for (const [filePath, content] of output) {
            if (!isSafeRelativePath(filePath)) throw new Error(`unsafe generated file path: ${filePath}`);
            const staged = join(stagingDirectory, filePath);
            mkdirSync(dirname(staged), { recursive: true });
            writeFileSync(staged, content);
        }
        for (const filePath of output.keys()) {
            const destination = join(target, filePath);
            mkdirSync(dirname(destination), { recursive: true });
            renameSync(join(stagingDirectory, filePath), destination);
        }
        for (const filePath of previous) {
            if (!output.has(filePath)) rmSync(join(target, filePath), { force: true });
        }
    } finally {
        rmSync(stagingDirectory, { recursive: true, force: true });
    }
}
