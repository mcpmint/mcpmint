import { zipGeneratedProject } from "./archive.ts";
import { prepareGeneratedProject } from "./core.ts";
import type {
    GeneratedPreviewResponse,
    GeneratedProject,
    GeneratorRequest,
    ValidationResult,
} from "./types.ts";

// Server generation deliberately excludes process-spawning verification.
// Full verification remains available in the local CLI, where the user owns
// the machine and resource budget. Keeping verify.ts out of this module also
// prevents Next output-file tracing from bundling the entire repository.
export function createServerPreview(request: GeneratorRequest): GeneratedPreviewResponse {
    const { project, validation } = prepareGeneratedProject(request);
    return {
        files: Array.from(project.files.entries()).map(([name, content]) => ({ name, content })),
        manifest: project.manifest,
        validation,
    };
}

export function createServerArchive(request: GeneratorRequest): {
    archive: Uint8Array;
    project: GeneratedProject;
    validation: ValidationResult;
} {
    const { project, validation } = prepareGeneratedProject(request);
    const archive = zipGeneratedProject(project, request.serverConfig.name);
    return { archive, project, validation };
}
