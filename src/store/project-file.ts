import { z } from "zod";
import { parseGeneratorRequestPayload } from "../lib/generator/request.ts";
import { buildGenerationPlan } from "../lib/generator/normalize.ts";
import { apiModelToParsedSpec } from "../lib/api-model/legacy.ts";
import { assertBoundedJson } from "../lib/json/bounds.ts";
import type {
    AuthConfig,
    ExportConfig,
    McpServerAuthConfig,
    ParsedSpec,
    ServerConfig,
    ToolConfig,
} from "./project-store";

export interface ProjectSnapshotData {
    spec: ParsedSpec;
    specSource: string;
    specFormat: string;
    tools: ToolConfig[];
    authConfig: AuthConfig;
    mcpServerAuthConfig: McpServerAuthConfig;
    serverConfig: ServerConfig;
    exportConfig: ExportConfig;
}

export interface PortableProjectFile {
    schemaVersion: 1;
    kind: "mcpmint-project";
    exportedAt: string;
    project: {
        id: string;
        name: string;
        source: string;
        format: string;
        endpointCount: number;
        savedAt: number;
    };
    data: ProjectSnapshotData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeProjectFile(file: PortableProjectFile): string {
    return `${JSON.stringify(file, null, 2)}\n`;
}

const metadataSchema = z.object({
    id: z.string().min(1).max(200), name: z.string().min(1).max(200),
    source: z.string().max(4000), format: z.enum(["openapi", "postman"]),
    endpointCount: z.number().int().min(0).max(10_000), savedAt: z.number().finite().min(0),
});

export function validateProjectSnapshot(input: unknown): ProjectSnapshotData {
    try { return validateSnapshot(input); }
    catch (error) {
        if (error instanceof z.ZodError) throw new Error(`Project configuration is invalid: ${error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Import a valid project file or the original specification.`);
        throw error;
    }
}

function validateSnapshot(input: unknown): ProjectSnapshotData {
    assertBoundedJson(input);
    if (!isRecord(input) || !isRecord(input.spec) || !isRecord(input.spec.apiModel)) {
        throw new Error("Project file does not contain a canonical parsed API model.");
    }
    const request = parseGeneratorRequestPayload(input);
    if (!request.spec.apiModel) throw new Error("Canonical API model is missing.");
    if (!Array.isArray(input.tools) || input.tools.some((tool) => !isRecord(tool) || !Array.isArray(tool.parameters))) {
        throw new Error("Project file contains invalid tools.");
    }
    const operationIds = new Set(request.spec.apiModel.operations.map((op) => op.id));
    if (operationIds.size !== request.spec.apiModel.operations.length || request.tools.some((tool) => !operationIds.has(tool.endpointId))
        || new Set(request.tools.map((tool) => tool.endpointId)).size !== request.tools.length) {
        throw new Error("Project tools must refer to unique operations in the imported API.");
    }
    const rawTools = input.tools;
    buildGenerationPlan(request); // Normalize the entire project before accepting or writing it.
    return {
        spec: apiModelToParsedSpec(request.spec.apiModel),
        specSource: z.string().max(4000).parse(input.specSource),
        specFormat: z.enum(["openapi", "postman"]).parse(input.specFormat),
        tools: request.tools.map((tool, index) => ({ ...tool,
            parameters: tool.parameters.map((parameter) => ({ ...parameter, location: parameter.location || "query" })),
            ...(isRecord(rawTools[index]) && typeof rawTools[index].bodyExample === "string"
                ? { bodyExample: rawTools[index].bodyExample as string } : {}),
        })),
        authConfig: request.authConfig,
        mcpServerAuthConfig: { ...request.mcpServerAuthConfig!, allowedOrigins: request.mcpServerAuthConfig?.allowedOrigins || [] },
        serverConfig: request.serverConfig,
        exportConfig: { ...request.exportConfig, verificationMode: request.exportConfig.verificationMode || "fast",
            compactMode: request.exportConfig.compactMode || false,
            features: { documentation: true, docker: false, tests: true, verification: false, ...request.exportConfig.features } },
    };
}

export function parseProjectFile(text: string): PortableProjectFile {
    if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error("Project files must be 10 MiB or smaller.");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("Project file is not valid JSON."); }
    if (!isRecord(value) || value.kind !== "mcpmint-project" || value.schemaVersion !== 1) {
        throw new Error("Unsupported project file. Expected a mcpmint-project with schemaVersion 1.");
    }
    const metadata = metadataSchema.safeParse(value.project);
    if (!metadata.success) throw new Error("Project file metadata is invalid.");
    const data = validateProjectSnapshot(value.data);
    if (metadata.data.endpointCount !== data.spec.endpoints.length) throw new Error("Project endpoint count does not match its API model.");
    return { schemaVersion: 1, kind: "mcpmint-project", exportedAt: z.string().datetime().parse(value.exportedAt), project: metadata.data, data };
}
