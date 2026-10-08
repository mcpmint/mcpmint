import type { ParsedSpec } from "../api-model/parsed-spec.ts";
import type {
  ApiModel,
  ApiOperation,
  ApiMediaType,
  ApiResponse,
  ApiSchema,
  ApiServer,
} from "../api-model/types.ts";
// Validation types
export interface ValidationMessage {
  type: "error" | "warning" | "info";
  message: string;
  code?: string;
  path?: string; // e.g., "POST /pet" or "GET /users/{id}.userId"
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
}

const UNSUPPORTED_SCHEMA_FEATURES = [
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "discriminator",
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
  "$dynamicRef",
  "$dynamicAnchor",
];

function pushWarning(
  warnings: ValidationMessage[],
  code: string,
  message: string,
  path?: string,
) {
  if (
    warnings.some(
      (warning) =>
        warning.code === code &&
        warning.message === message &&
        warning.path === path,
    )
  ) {
    return;
  }

  warnings.push({ type: "warning", code, message, path });
}

function contentTypeIsBinary(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return (
    normalized.includes("application/octet-stream") ||
    normalized.includes("application/pdf") ||
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/")
  );
}

function schemaHasComposition(schema: ApiSchema): boolean {
  return Boolean(
    schema.oneOf || schema.anyOf || schema.allOf || Array.isArray(schema.type),
  );
}

function isBinaryValidationSchema(schema?: ApiSchema): boolean {
  return schema?.format === "binary" || schema?.type === "file";
}

function schemaContainsBinary(schema?: ApiSchema): boolean {
  if (!schema) return false;
  if (isBinaryValidationSchema(schema)) return true;

  const properties = schema.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    if (
      Object.values(properties as Record<string, ApiSchema>).some(
        schemaContainsBinary,
      )
    )
      return true;
  }

  const items = schema.items;
  if (
    items &&
    typeof items === "object" &&
    !Array.isArray(items) &&
    schemaContainsBinary(items as ApiSchema)
  ) {
    return true;
  }

  return ["oneOf", "anyOf", "allOf"].some((keyword) => {
    const value = schema[keyword];
    return (
      Array.isArray(value) &&
      value.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          schemaContainsBinary(item as ApiSchema),
      )
    );
  });
}

function isSimpleScalarValidationSchema(schema: ApiSchema): boolean {
  if (schemaHasComposition(schema)) return false;
  if (schema.properties || schema.items || schema.additionalProperties)
    return false;

  if (Array.isArray(schema.enum)) {
    return schema.enum.every(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null,
    );
  }

  return ["string", "number", "integer", "boolean"].includes(
    String(schema.type || ""),
  );
}

function isShallowSimpleValidationObjectSchema(schema?: ApiSchema): boolean {
  if (!schema || schemaHasComposition(schema)) return false;
  if (schema.type && schema.type !== "object") return false;
  if (schema.additionalProperties) return false;
  if (
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  )
    return false;

  return Object.values(schema.properties as Record<string, ApiSchema>).every(
    isSimpleScalarValidationSchema,
  );
}

function getValidationBodyContentKind(
  mediaType: string,
  schema?: ApiSchema,
):
  | "flattenedObject"
  | "rawJsonObject"
  | "rawArray"
  | "binary"
  | "multipart"
  | "formUrlencoded"
  | "text"
  | undefined {
  const contentType = mediaType.toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded"))
    return "formUrlencoded";
  if (contentType.includes("multipart/form-data")) return "multipart";
  if (contentType.startsWith("text/")) return "text";
  if (contentTypeIsBinary(contentType) || isBinaryValidationSchema(schema))
    return "binary";
  if (
    !contentType.includes("application/json") &&
    !contentType.includes("+json")
  )
    return undefined;
  if (schema?.type === "array") return "rawArray";
  if (isShallowSimpleValidationObjectSchema(schema)) return "flattenedObject";
  if (schema) return "rawJsonObject";
  return "flattenedObject";
}

function collectUnsupportedSchemaFeatures(
  schema: unknown,
  features = new Set<string>(),
): Set<string> {
  if (!schema || typeof schema !== "object") return features;

  if (Array.isArray(schema)) {
    for (const item of schema) collectUnsupportedSchemaFeatures(item, features);
    return features;
  }

  const record = schema as Record<string, unknown>;
  for (const feature of UNSUPPORTED_SCHEMA_FEATURES) {
    if (record[feature] !== undefined) features.add(feature);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectUnsupportedSchemaFeatures(value, features);
    }
  }

  return features;
}

function hasDynamicServerVariables(server?: ApiServer): boolean {
  if (!server) return false;
  return (
    Boolean(server.variables && Object.keys(server.variables).length > 0) ||
    /\{[^}]+\}/.test(server.url)
  );
}

function hasAmbiguousAuth(
  operation: ApiOperation,
  apiModel: ApiModel,
): boolean {
  const requirements = operation.security ?? apiModel.security;
  if (requirements.length > 1) return true;
  return requirements.some(
    (requirement) => Object.keys(requirement).length > 1,
  );
}

function hasUnsupportedAuth(
  operation: ApiOperation,
  apiModel: ApiModel,
): boolean {
  const requirements = operation.security ?? apiModel.security;
  return requirements.some((requirement) =>
    Object.keys(requirement).some(
      (schemeName) => !apiModel.securitySchemes[schemeName],
    ),
  );
}

function warnUnsupportedSchemaFeatures(
  warnings: ValidationMessage[],
  schema: unknown,
  location: string,
  endpointPath?: string,
) {
  const features = [...collectUnsupportedSchemaFeatures(schema)].sort();
  if (features.length === 0) return;

  pushWarning(
    warnings,
    "unsupported-schema-feature",
    `Unsupported schema features found in ${location}: ${features.join(", ")}`,
    endpointPath,
  );
}

function warnMultipleContentTypes(
  warnings: ValidationMessage[],
  content: ApiMediaType[] | undefined,
  location: string,
  endpointPath: string,
) {
  if (!content || content.length <= 1) return;

  pushWarning(
    warnings,
    "multiple-content-types",
    `${location} defines multiple content types (${content.map((media) => media.mediaType).join(", ")}); verify the generated tool uses the intended one.`,
    endpointPath,
  );
}

function responseContent(response: ApiResponse): ApiMediaType[] | undefined {
  return response.content && response.content.length > 0
    ? response.content
    : undefined;
}

function warnApiModelDetails(spec: ParsedSpec, warnings: ValidationMessage[]) {
  const apiModel = spec.apiModel;
  if (!apiModel) return;

  if (apiModel.servers.some(hasDynamicServerVariables)) {
    pushWarning(
      warnings,
      "dynamic-server-variables",
      "Server URL contains variables; defaults were used during import and may need review.",
    );
  }

  for (const operation of apiModel.operations) {
    const endpointPath = `${operation.method} ${operation.path}`;
    const manualReviewReasons: string[] = [];

    if (
      operation.servers?.some(hasDynamicServerVariables) ||
      operation.pathServers?.some(hasDynamicServerVariables)
    ) {
      pushWarning(
        warnings,
        "dynamic-server-variables",
        "Endpoint uses server URL variables; defaults were used during import and may need review.",
        endpointPath,
      );
      manualReviewReasons.push("dynamic server variables");
    }

    if (hasAmbiguousAuth(operation, apiModel)) {
      pushWarning(
        warnings,
        "ambiguous-auth",
        "Endpoint has multiple or combined auth requirements; verify the generated auth behavior.",
        endpointPath,
      );
      manualReviewReasons.push("ambiguous auth");
    }

    if (hasUnsupportedAuth(operation, apiModel)) {
      pushWarning(
        warnings,
        "auth-scheme-mismatch",
        "Endpoint references auth schemes that were not found in the imported security schemes.",
        endpointPath,
      );
      manualReviewReasons.push("auth scheme mismatch");
    }

    for (const parameter of operation.parameters) {
      warnUnsupportedSchemaFeatures(
        warnings,
        parameter.schema,
        `parameter "${parameter.name}"`,
        endpointPath,
      );
    }

    warnMultipleContentTypes(
      warnings,
      operation.requestBody?.content,
      "Request body",
      endpointPath,
    );

    const requestMedia = operation.requestBody?.content[0];
    if (requestMedia) {
      warnUnsupportedSchemaFeatures(
        warnings,
        requestMedia.schema,
        "request body",
        endpointPath,
      );

      const contentKind = getValidationBodyContentKind(
        requestMedia.mediaType,
        requestMedia.schema,
      );

      if (
        requestMedia.mediaType === "multipart/form-data" ||
        contentKind === "binary" ||
        contentTypeIsBinary(requestMedia.mediaType) ||
        schemaContainsBinary(requestMedia.schema)
      ) {
        pushWarning(
          warnings,
          "binary-file-upload",
          "Endpoint uses binary or file upload data; verify file serialization in the generated client.",
          endpointPath,
        );
        manualReviewReasons.push("binary/file upload");
      }

      if (
        contentKind === "rawArray" ||
        (contentKind === "rawJsonObject" &&
          !isShallowSimpleValidationObjectSchema(requestMedia.schema))
      ) {
        pushWarning(
          warnings,
          "raw-body",
          "Complex request body will be exposed as a raw `body` argument instead of flattened fields.",
          endpointPath,
        );
        manualReviewReasons.push("raw body");
      }

      if (requestMedia.mediaType && !contentKind) {
        manualReviewReasons.push("unmapped content type");
      }
    }

    for (const response of operation.responses) {
      const content = responseContent(response);
      warnMultipleContentTypes(
        warnings,
        content,
        `Response ${response.statusCode}`,
        endpointPath,
      );
      for (const media of content || []) {
        warnUnsupportedSchemaFeatures(
          warnings,
          media.schema,
          `response ${response.statusCode}`,
          endpointPath,
        );
      }
    }

    if (manualReviewReasons.length > 0) {
      pushWarning(
        warnings,
        "manual-review",
        `Endpoint requires manual review: ${[...new Set(manualReviewReasons)].join(", ")}.`,
        endpointPath,
      );
    }
  }
}

// Validate a parsed spec and return detailed feedback
export function validateSpec(spec: ParsedSpec): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const info: ValidationMessage[] = [];

  // Check API info
  if (!spec.info.title) {
    errors.push({ type: "error", message: "API title is missing" });
  }
  if (!spec.info.version) {
    warnings.push({ type: "warning", message: "API version is not specified" });
  }
  if (!spec.info.description) {
    info.push({ type: "info", message: "API description is not provided" });
  }

  // Check base URL
  if (!spec.baseUrl) {
    pushWarning(
      warnings,
      "missing-base-url",
      "No base URL defined - you'll need to configure it manually",
    );
  } else if (spec.baseUrl.includes("{") || spec.baseUrl.includes("localhost")) {
    info.push({
      type: "info",
      message: `Base URL "${spec.baseUrl}" may need to be updated for production`,
    });
  }

  // Check endpoints
  if (spec.endpoints.length === 0) {
    errors.push({
      type: "error",
      message: "No endpoints found in the specification",
    });
  }

  for (const endpoint of spec.endpoints) {
    const endpointPath = `${endpoint.method} ${endpoint.path}`;

    // Check for missing description
    if (!endpoint.summary && !endpoint.description) {
      warnings.push({
        type: "warning",
        message: `Missing description for endpoint`,
        path: endpointPath,
      });
    }

    // Check for missing operationId
    if (!endpoint.operationId) {
      info.push({
        type: "info",
        message: `No operationId - tool name will be auto-generated`,
        path: endpointPath,
      });
    }

    // Check parameters
    for (const param of endpoint.parameters) {
      if (!param.description) {
        info.push({
          type: "info",
          message: `Parameter "${param.name}" has no description`,
          path: endpointPath,
        });
      }

      // Check for path params that might be missing in path
      if (param.in === "path" && !endpoint.path.includes(`{${param.name}}`)) {
        pushWarning(
          warnings,
          "path-param-mismatch",
          `Path parameter "${param.name}" not found in path "${endpoint.path}"`,
          endpointPath,
        );
      }
    }

    // Check request body for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      if (!endpoint.requestBody) {
        info.push({
          type: "info",
          message: `No request body defined for ${endpoint.method} request`,
          path: endpointPath,
        });
      } else if (
        !endpoint.requestBody.schema ||
        Object.keys(endpoint.requestBody.schema).length === 0
      ) {
        pushWarning(
          warnings,
          "empty-request-body-schema",
          "Request body schema is empty or undefined",
          endpointPath,
        );
      }
    }
  }

  warnApiModelDetails(spec, warnings);

  // Check security schemes
  if (Object.keys(spec.securitySchemes).length === 0) {
    info.push({ type: "info", message: "No authentication schemes defined" });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}

// ---------------------------------------------------------------------------
// Validation summary plumbing (Wave 2, Task 3)
// ---------------------------------------------------------------------------
// validateSpec() above produces rich errors/warnings/info but was never
// surfaced in the UI. These helpers:
//   - build a concise, serializable summary for a banner on entering the editor,
//   - stash it in sessionStorage so the editor can pick it up once (we cannot
//     extend the Zustand store from the import feature), and
//   - index warnings by endpoint path so the editor can render per-endpoint
//     badges. All of this REUSES validateSpec() — no duplicated detection.
// ---------------------------------------------------------------------------

// Legacy localStorage key kept intentionally so cached validation summaries survive the mcpmint rebrand.
const VALIDATION_SUMMARY_STORAGE_KEY = "makemcp-validation-summary";

export interface ValidationSummary {
  title: string;
  endpointCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Short sentence, e.g. "Parsed Petstore — 19 endpoints, 2 warnings". */
  headline: string;
  /** A few notable messages (deduped, spec-level first). */
  notable: string[];
}

function firstUniqueValidationMessages(
  messages: ValidationMessage[],
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    const text = message.path
      ? `${message.path}: ${message.message}`
      : message.message;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildValidationSummary(
  spec: ParsedSpec,
  label?: string,
): ValidationSummary {
  const result = validateSpec(spec);
  const title = label || spec.info.title || "API";
  const endpointCount = spec.endpoints.length;

  const parts = [`${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`];
  if (result.errors.length > 0) {
    parts.push(
      `${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`,
    );
  }
  if (result.warnings.length > 0) {
    parts.push(
      `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`,
    );
  }

  // Spec-level messages (no path) are the most actionable, list them first;
  // errors before warnings.
  const ordered = [
    ...result.errors.filter((message) => !message.path),
    ...result.warnings.filter((message) => !message.path),
    ...result.errors.filter((message) => message.path),
    ...result.warnings.filter((message) => message.path),
  ];

  return {
    title,
    endpointCount,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    infoCount: result.info.length,
    headline: `Parsed ${title} — ${parts.join(", ")}`,
    notable: firstUniqueValidationMessages(ordered, 4),
  };
}

/** Persist the summary so the editor can display it once on arrival. */
export function stashValidationSummary(summary: ValidationSummary): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      VALIDATION_SUMMARY_STORAGE_KEY,
      JSON.stringify(summary),
    );
  } catch {
    /* sessionStorage unavailable — the banner is a nice-to-have, skip it. */
  }
}

/** Read (and clear) the stashed summary. Returns null if none. */
export function consumeValidationSummary(): ValidationSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(VALIDATION_SUMMARY_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(VALIDATION_SUMMARY_STORAGE_KEY);
    return JSON.parse(raw) as ValidationSummary;
  } catch {
    return null;
  }
}

/**
 * Index warning + error messages by endpoint path ("METHOD /path") so the
 * editor can attach per-endpoint badges. Spec-level messages (no path) are
 * intentionally excluded — those go in the banner.
 */
export function buildEndpointWarnings(
  spec: ParsedSpec,
): Map<string, ValidationMessage[]> {
  const result = validateSpec(spec);
  const byPath = new Map<string, ValidationMessage[]>();

  const add = (message: ValidationMessage) => {
    if (!message.path) return;
    const list = byPath.get(message.path) ?? [];
    if (
      list.some(
        (existing) =>
          existing.code === message.code &&
          existing.message === message.message,
      )
    )
      return;
    list.push(message);
    byPath.set(message.path, list);
  };

  result.errors.forEach(add);
  result.warnings.forEach(add);

  return byPath;
}
