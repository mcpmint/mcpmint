// Browser-safe project generation + zip.
//
// This file must not import @/lib/generator (index.ts), because that reaches
// verify.ts, which imports node:fs and node:child_process. It uses only the
// pure pieces: request validation, core.ts (plan, validate, target) and the
// fflate archive. It runs in the dedicated processing worker.

import { prepareGeneratedProject } from "@/lib/generator/core";
import { sanitizeRootFolder, zipGeneratedProject } from "@/lib/generator/archive";
import { parseGeneratorRequestPayload } from "@/lib/generator/request";
import type {
  GeneratedProject,
  ValidationResult,
} from "@/lib/generator/types";

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
 * Generate the MCP server project entirely in the browser and return a
 * downloadable zip Blob. Takes the SAME payload shape the server route accepts
 * (validated via the shared Zod schema). No Node APIs, no network calls — the
 * spec never leaves the browser.
 *
 * Note: post-generation verification (verify.ts) is intentionally NOT run here
 * — it shells out to tsc / npm / python and cannot run in the browser. Full
 * verification remains a local CLI capability.
 */
export function generateProjectInBrowser(payload: unknown): ClientGenerationResult {
  const request = parseGeneratorRequestPayload(payload);
  const { project, validation } = prepareGeneratedProject(request);
  const rootFolder = sanitizeRootFolder(request.serverConfig.name);
  // Copy into a fresh ArrayBuffer-backed view so the Blob owns a plain
  // ArrayBuffer (avoids SharedArrayBuffer typing friction with BlobPart).
  const blob = new Blob([zipGeneratedProject(project, rootFolder).slice()], { type: "application/zip" });

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
  const { project, validation } = prepareGeneratedProject(parseGeneratorRequestPayload(payload));

  return {
    files: Array.from(project.files.entries()).map(([name, content]) => ({ name, content })),
    manifest: project.manifest,
    validation,
  };
}
