import { z } from "zod";
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

export function parseProjectFile(text: string): PortableProjectFile {
  assertTextSize(text, MAX_PROJECT_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Project file is not valid JSON${error instanceof Error ? `: ${error.message}` : ""}`,
    );
  }
  if (
    !isRecord(value) ||
    value.kind !== "mcpmint-project" ||
    value.schemaVersion !== 1
  ) {
    throw new Error(
      "Unsupported project file. Expected a mcpmint-project with schemaVersion 1.",
    );
  }
  if (
    !isRecord(value.project) ||
    typeof value.project.id !== "string" ||
    typeof value.project.name !== "string"
  ) {
    throw new Error("Project file metadata is missing a valid id or name.");
  }
  if (
    !isRecord(value.data) ||
    !isRecord(value.data.spec) ||
    !isRecord(value.data.spec.apiModel)
  ) {
    throw new Error(
      "Project file does not contain a canonical parsed API model.",
    );
  }
  if (
    !Array.isArray(value.data.tools) ||
    !isRecord(value.data.serverConfig) ||
    !isRecord(value.data.exportConfig)
  ) {
    throw new Error(
      "Project file is missing tool or generation configuration.",
    );
  }
  return validateProjectFile(value);
}

const object = z.record(z.string(), z.unknown());
const endpointSchema = z.object({
  id: z.string().min(1).max(2000),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string().max(4000),
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).max(2000).optional(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        in: z.enum(["query", "path", "header", "cookie"]),
        required: z.boolean(),
        type: z.string(),
        description: z.string().optional(),
      }),
    )
    .max(2000),
  requestBody: z
    .object({ required: z.boolean(), contentType: z.string(), schema: object })
    .optional(),
});
const portableSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("mcpmint-project"),
  exportedAt: z.iso.datetime(),
  project: z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(2000),
    source: z.string().max(4000),
    format: z.string().max(200),
    endpointCount: z.number().int().min(0).max(MAX_OPERATIONS),
    savedAt: z.number().finite().nonnegative(),
  }),
  data: z.object({
    spec: z.object({
      info: z.object({
        title: z.string(),
        version: z.string(),
        description: z.string().optional(),
      }),
      baseUrl: z.string().max(4000),
      endpoints: z.array(endpointSchema).max(MAX_OPERATIONS),
      securitySchemes: object,
      format: z.string().optional(),
      apiModel: apiModelSchema,
    }),
    specSource: z.string().max(4000),
    specFormat: z.string().max(200),
    tools: z
      .array(toolSchema.extend({ bodyExample: z.string().optional() }))
      .max(MAX_OPERATIONS),
    authConfig: authSchema,
    mcpServerAuthConfig: mcpServerAuthSchema,
    serverConfig: serverConfigSchema,
    exportConfig: exportSchema,
  }),
});
export function validateProjectFile(value: unknown): PortableProjectFile {
  assertGraphBudget(value);
  const file = portableSchema.parse(value) as PortableProjectFile;
  const ids = new Set(file.data.spec.endpoints.map((endpoint) => endpoint.id));
  const operationIds = new Set(
    file.data.spec.apiModel!.operations.map((operation) => operation.id),
  );
  const toolIds = new Set(file.data.tools.map((tool) => tool.endpointId));
  if (
    ids.size !== file.data.spec.endpoints.length ||
    operationIds.size !== file.data.spec.apiModel!.operations.length ||
    toolIds.size !== file.data.tools.length ||
    file.data.tools.some(
      (tool) => !ids.has(tool.endpointId) || !operationIds.has(tool.endpointId),
    )
  ) {
    throw new Error(
      "Project tools must reference unique, valid API endpoints.",
    );
  }
  const operations = new Map(
    file.data.spec.apiModel!.operations.map((operation) => [
      operation.id,
      operation,
    ]),
  );
  if (
    file.data.spec.endpoints.some((endpoint) => {
      const operation = operations.get(endpoint.id);
      return (
        !operation ||
        operation.method !== endpoint.method ||
        operation.path !== endpoint.path
      );
    })
  )
    throw new Error(
      "Project endpoint methods and paths must match the canonical API model.",
    );
  file.project.endpointCount = file.data.spec.endpoints.length;
  return file;
}
