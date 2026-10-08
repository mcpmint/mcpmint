// Browser-safe project generation + zip.
//
// The server path (src/app/api/generate/route.ts -> @/lib/generator index.ts)
// pulls in archive.ts, which imports `archiver` (a Node-only module backed by
// fs/streams). It also transitively reaches verify.ts, which imports node:fs,
// node:child_process, etc. Neither can run in — or be bundled into — the
// browser.
//
// To keep the client bundle free of Node-only modules, this file deliberately
// does NOT import from @/lib/generator (the index that re-exports archive.ts).
// Instead it imports only the PURE generator pieces directly:
//   - buildGenerationPlan  (normalize.ts)   -> plan
//   - validateGenerationPlan (validate.ts)  -> validation
//   - generateNodeProject / generatePythonProject (targets/*) -> file map
//   - parseGeneratorRequestPayload (request.ts, Zod) -> input validation
// It then zips the in-memory file map with fflate (zip + strToU8), which is a
// tiny pure-JS zip implementation with no Node dependencies. The asynchronous
// generation and compression run in the dedicated application worker.

import { zipSync, strToU8 } from "fflate";
import { buildGenerationPlan } from "@/lib/generator/normalize";
import { validateGenerationPlan } from "@/lib/generator/validate";
import { parseGeneratorRequestPayload } from "@/lib/generator/request";
import { generateNodeProject } from "@/lib/generator/targets/node";
import { generatePythonProject } from "@/lib/generator/targets/python";
import type {
  GeneratedProject,
  GeneratorRequest,
  ValidationResult,
} from "@/lib/generator/types";

// Mirrors archive.ts sanitizeRootFolder so the browser-produced zip has the
// exact same root folder as the server-produced one. Defense-in-depth against
// Zip Slip / path traversal via the user-controlled server name.
function sanitizeRootFolder(rootFolder: string): string {
  const cleaned = rootFolder
    .replace(/[\\/]+/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 64);

  return cleaned.length > 0 ? cleaned : "mcp-server";
}

// Mirrors index.ts generateProject: pick the target by runtime language.
function generateProject(plan: ReturnType<typeof buildGenerationPlan>): GeneratedProject {
  return plan.runtime.language === "node"
    ? generateNodeProject(plan)
    : generatePythonProject(plan);
}

export interface ClientGenerationResult {
  blob: Blob;
  filename: string;
  project: GeneratedProject;
  validation: ValidationResult;
}

export interface ClientPreviewResult {
  files: Array<{ name: string; content: string }>;
  manifest: GeneratedProject["manifest"];
  validation: ValidationResult;
}

/**
 * Build the generated project in-memory (no zip). Shared by download + preview
 * so both privacy paths stay fully client-side.
 */
function buildProjectInBrowser(payload: unknown): {
  request: GeneratorRequest;
  project: GeneratedProject;
  validation: ValidationResult;
} {
  // Validate + normalize the payload with the same schema the server uses, so
  // browser and server produce identical output for identical input.
  const request: GeneratorRequest = parseGeneratorRequestPayload(payload);

  const plan = buildGenerationPlan(request);
  const validation = validateGenerationPlan(plan);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.map((error) => error.message).join("\n"));
  }

  const project = generateProject(plan);
  return { request, project, validation };
}

/**
 * Generate the MCP server project entirely in the browser and return a
 * downloadable zip Blob. Takes the SAME payload shape the server route accepts
 * (validated via the shared Zod schema). No Node APIs, no network calls — the
 * spec never leaves the browser.
 *
 * Note: post-generation verification (verify.ts) is intentionally NOT run here
 * — it shells out to tsc / npm / python and cannot run in the browser. Full
 * verification remains a local CLI capability.
 */
export async function generateProjectInBrowser(payload: unknown): Promise<ClientGenerationResult> {
  const { request, project, validation } = buildProjectInBrowser(payload);

  const rootFolder = sanitizeRootFolder(request.serverConfig.name);

  // fflate zip takes a nested/flat map of path -> Uint8Array. We prefix
  // every file with the sanitized root folder to match the server archive
  // layout (rootFolder/<file>).
  const zipInput: Record<string, Uint8Array> = {};
  for (const [filePath, content] of project.files) {
    zipInput[`${rootFolder}/${filePath}`] = strToU8(content);
  }

  // This module is executed inside the dedicated processing worker.
  // Synchronous compression there avoids nested blob workers and their CSP/startup failures.
  const zipped = zipSync(zipInput, { level: 6 });

  // Copy into a fresh ArrayBuffer-backed view so the Blob owns a plain
  // ArrayBuffer (avoids SharedArrayBuffer typing friction with BlobPart).
  const blob = new Blob([zipped.slice()], { type: "application/zip" });

  return {
    blob,
    filename: `${rootFolder}.zip`,
    project,
    validation,
  };
}

/**
 * Preview generated files entirely in the browser (same pure pipeline as
 * generateProjectInBrowser, without zip). Used when privacy mode is on so the
 * full apiModel never uploads for a file preview.
 */
export function previewProjectInBrowser(payload: unknown): ClientPreviewResult {
  const { project, validation } = buildProjectInBrowser(payload);

  return {
    files: Array.from(project.files.entries()).map(([name, content]) => ({ name, content })),
    manifest: project.manifest,
    validation,
  };
}
