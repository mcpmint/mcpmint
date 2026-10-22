import { prepareGeneratedProject as prepareCoreProject } from "./core.ts";
import type {
    GeneratedPreviewResponse,
    GeneratedProject,
    GeneratorRequest,
    ValidationResult,
    VerificationReport,
} from "./types.ts";
import { verifyGeneratedProject } from "./verify.ts";

function prepareGeneratedProject(request: GeneratorRequest): {
    project: GeneratedProject;
    validation: ValidationResult;
    verification?: VerificationReport;
} {
    const { plan, project, validation } = prepareCoreProject(request);
    const verification = plan.features.verification
        ? verifyGeneratedProject(project, plan.verificationMode)
        : undefined;

    return { project, validation, verification };
}

export function createPreviewResponse(request: GeneratorRequest): GeneratedPreviewResponse {
    const { project, validation, verification } = prepareGeneratedProject(request);

    return {
        files: Array.from(project.files.entries()).map(([name, content]) => ({ name, content })),
        manifest: project.manifest,
        validation,
        verification,
    };
}

export type {
    GeneratedProject,
    GeneratedPreviewResponse,
    GeneratorRequest,
    ToolPlan,
    ValidationResult,
    VerificationReport,
} from "./types.ts";
export { buildToolPlans, planToolFromOperation } from "./planner.ts";
