import type { ParsedSpec } from "./api-model/parsed-spec";
import type { ApiOperation } from "./api-model/types";

export type SpecChangeKind = "added" | "removed" | "changed";

export interface SpecChange {
  kind: SpecChangeKind;
  key: string;
  operationId?: string;
  method: string;
  path: string;
  details: string[];
}

export interface SpecDiff {
  oldVersion: string;
  newVersion: string;
  changes: SpecChange[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  configurationChanges: string[];
}

function keyOf(operation: { method: string; path: string }): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationsOf(spec: ParsedSpec): ApiOperation[] {
  if (spec.apiModel) return spec.apiModel.operations;
  return spec.endpoints.map((endpoint) => ({
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    description: endpoint.description,
    parameters: [],
    responses: [],
  }));
}

function operationFingerprint(operation: ApiOperation): Record<string, unknown> {
  return {
    operationId: operation.operationId,
    parameters: operation.parameters,
    requestBody: operation.requestBody,
    responses: operation.responses,
    security: operation.security,
    servers: operation.servers,
    deprecated: operation.deprecated,
  };
}

export function diffSpecs(previous: ParsedSpec, next: ParsedSpec): SpecDiff {
  const before = new Map(operationsOf(previous).map((operation) => [keyOf(operation), operation]));
  const after = new Map(operationsOf(next).map((operation) => [keyOf(operation), operation]));
  const changes: SpecChange[] = [];
  let unchanged = 0;

  for (const [key, operation] of after) {
    const old = before.get(key);
    if (!old) {
      changes.push({ kind: "added", key, operationId: operation.id, method: operation.method, path: operation.path, details: ["New operation"] });
      continue;
    }
    const details: string[] = [];
    if (old.operationId !== operation.operationId) details.push(`operationId: ${old.operationId || "none"} → ${operation.operationId || "none"}`);
    if (stable(old.parameters) !== stable(operation.parameters)) details.push("Parameters changed");
    if (stable(old.requestBody) !== stable(operation.requestBody)) details.push("Request body changed");
    if (stable(old.responses) !== stable(operation.responses)) details.push("Response contract changed");
    if (stable(old.security) !== stable(operation.security)) details.push("Authentication requirements changed");
    if (stable(old.servers) !== stable(operation.servers)) details.push("Operation server changed");
    if (stable(operationFingerprint(old)) !== stable(operationFingerprint(operation)) && details.length === 0) details.push("Operation metadata changed");
    if (details.length > 0) changes.push({ kind: "changed", key, operationId: operation.id, method: operation.method, path: operation.path, details });
    else unchanged += 1;
  }
  for (const [key, operation] of before) {
    if (!after.has(key)) changes.push({ kind: "removed", key, operationId: operation.id, method: operation.method, path: operation.path, details: ["Operation removed"] });
  }
  const configurationChanges: string[] = [];
  if (stable(previous.apiModel?.security) !== stable(next.apiModel?.security) || stable(previous.apiModel?.securitySchemes) !== stable(next.apiModel?.securitySchemes)) configurationChanges.push("Source authentication changed. Your configured upstream auth is preserved; review credentials and requirements before exporting.");
  if (stable(previous.apiModel?.servers) !== stable(next.apiModel?.servers) || previous.baseUrl !== next.baseUrl) configurationChanges.push("Default API server changed. Review the destination before exporting.");
  return {
    configurationChanges,
    oldVersion: previous.info.version,
    newVersion: next.info.version,
    changes,
    added: changes.filter((change) => change.kind === "added").length,
    removed: changes.filter((change) => change.kind === "removed").length,
    changed: changes.filter((change) => change.kind === "changed").length,
    unchanged,
  };
}
