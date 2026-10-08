import { z } from "zod";
import { apiModelToParsedSpec } from "../lib/api-model/legacy.ts";
import { buildGenerationPlan } from "../lib/generator/normalize.ts";
import {
  apiModelSchema,
  authSchema,
  mcpServerAuthSchema,
  exportSchema,
  serverConfigSchema,
  toolSchema,
} from "../lib/generator/request.ts";
import {
  assertGraphBudget,
  assertTextSize,
  MAX_PROJECT_BYTES,
  MAX_OPERATIONS,
} from "../lib/processing/limits.ts";
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
  id: z.string().min(1).max(200), name: z.string().min(1).max(2000),
  source: z.string().max(4000), format: z.enum(["openapi", "postman"]),
  endpointCount: z.number().int().nonnegative().max(MAX_OPERATIONS), savedAt: z.number().finite().nonnegative(),
});
const snapshotSchema = z.object({
  spec: z.object({ apiModel: apiModelSchema }),
  specSource: z.string().max(4000), specFormat: z.enum(["openapi", "postman"]),
  tools: z.array(toolSchema.extend({ parameters: toolSchema.shape.parameters, bodyExample: z.string().optional() })).max(MAX_OPERATIONS),
  authConfig: authSchema, mcpServerAuthConfig: mcpServerAuthSchema,
  serverConfig: serverConfigSchema, exportConfig: exportSchema,
});

export function validateProjectSnapshot(input: unknown): ProjectSnapshotData {
  assertGraphBudget(input);
  try {
    const data = snapshotSchema.parse(input);
    const operationIds = new Set(data.spec.apiModel.operations.map((operation) => operation.id));
    if (operationIds.size !== data.spec.apiModel.operations.length
        || data.tools.some((tool) => !operationIds.has(tool.endpointId))
        || new Set(data.tools.map((tool) => tool.endpointId)).size !== data.tools.length) {
      throw new Error("Project tools must refer to unique operations in the imported API.");
    }
    const selected = data.tools.filter((tool) => tool.enabled);
    if (selected.length > 500) throw new Error("Select at most 500 tools per generated server.");
    const spec = apiModelToParsedSpec(data.spec.apiModel);
    buildGenerationPlan({ ...data, spec, tools: selected });
    return {
      ...data, spec,
      tools: data.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter, location: parameter.location || "query" })) })),
      exportConfig: { ...data.exportConfig, features: { documentation: true, docker: false, tests: true, verification: false, ...data.exportConfig.features } },
    } as ProjectSnapshotData;
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(`Project configuration is invalid: ${error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Import a valid project file or the original specification.`);
    throw error;
  }
}

export function validateProjectFile(value: unknown): PortableProjectFile {
  assertGraphBudget(value);
  if (!isRecord(value) || value.kind !== "mcpmint-project" || value.schemaVersion !== 1) throw new Error("Unsupported project file. Expected a mcpmint-project with schemaVersion 1.");
  const metadata = metadataSchema.safeParse(value.project);
  if (!metadata.success) throw new Error("Project file metadata is invalid.");
  const data = validateProjectSnapshot(value.data);
  if (metadata.data.endpointCount !== data.spec.endpoints.length) throw new Error("Project endpoint count does not match its API model.");
  return { kind: "mcpmint-project", schemaVersion: 1, exportedAt: z.iso.datetime().parse(value.exportedAt), project: metadata.data, data };
}

export function parseProjectFile(text: string): PortableProjectFile {
  assertTextSize(text, MAX_PROJECT_BYTES);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Project file is not valid JSON."); }
  return validateProjectFile(value);
}
