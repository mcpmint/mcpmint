import type { ToolConfig } from "../store/project-store";
import type { ParsedEndpoint } from "./api-model/parsed-spec";
import {
  getBodyContentKind,
  isBinarySchema,
  isShallowSimpleObjectSchema,
} from "./generator/utils.ts";

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safeValue = normalized || fallback;
  return /^[a-zA-Z_]/.test(safeValue) ? safeValue : `${fallback}_${safeValue}`;
}

export function sanitizeToolConfig(tool: ToolConfig): ToolConfig {
  return {
    ...tool,
    toolName: sanitizeIdentifier(tool.toolName, "tool"),
    parameters: tool.parameters.map((parameter, index) => ({
      ...parameter,
      name: sanitizeIdentifier(parameter.name, `param_${index + 1}`),
      hidden: parameter.hidden || false,
    })),
  };
}

// Generate a human-readable type string from schema
function getTypeFromSchema(schema: Record<string, unknown>, depth = 0): string {
  if (!schema) return "any";
  if (depth > 32 || schema.$ref) return "object";

  const type = schema.type as string;

  if (type === "array") {
    const items = schema.items as Record<string, unknown>;
    if (items) {
      return `${getTypeFromSchema(items, depth + 1)}[]`;
    }
    return "any[]";
  }

  if (type === "object" || schema.properties) {
    // Return a summary of the object structure
    const props = schema.properties as Record<string, Record<string, unknown>>;
    if (props) {
      const keys = Object.keys(props).slice(0, 3);
      const suffix = Object.keys(props).length > 3 ? ", ..." : "";
      return `{${keys.join(", ")}${suffix}}`;
    }
    return "object";
  }

  return type || "string";
}

// Generate example value from schema (recursively resolves nested objects)
function generateExampleFromSchema(
  schema: Record<string, unknown>,
  depth = 0,
): unknown {
  if (!schema) return null;
  if (depth > 32 || schema.$ref) return null;

  const type = schema.type as string;
  const example = schema.example;
  const defaultVal = schema.default;

  // Use example or default if provided
  if (example !== undefined) return example;
  if (defaultVal !== undefined) return defaultVal;

  // Handle enums
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Generate based on type
  switch (type) {
    case "string":
      if (schema.format === "date") return "2024-01-15";
      if (schema.format === "date-time") return "2024-01-15T10:30:00Z";
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "uri" || schema.format === "url")
        return "https://example.com";
      if (schema.format === "uuid")
        return "550e8400-e29b-41d4-a716-446655440000";
      return "string";

    case "integer":
    case "number":
      if (schema.minimum !== undefined) return schema.minimum;
      return 0;

    case "boolean":
      return true;

    case "array":
      const items = schema.items as Record<string, unknown>;
      if (items) {
        return [generateExampleFromSchema(items, depth + 1)];
      }
      return [];

    case "object":
    default:
      const properties = schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      if (properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(properties)) {
          obj[key] = generateExampleFromSchema(propSchema, depth + 1);
        }
        return obj;
      }
      // If no type but has properties, treat as object
      if (!type && schema.properties) {
        const props = schema.properties as Record<
          string,
          Record<string, unknown>
        >;
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(props)) {
          obj[key] = generateExampleFromSchema(propSchema, depth + 1);
        }
        return obj;
      }
      return {};
  }
}

// Generate tool name from endpoint
function generateToolName(endpoint: ParsedEndpoint): string {
  if (endpoint.operationId) {
    return sanitizeIdentifier(endpoint.operationId, "tool");
  }

  // Generate from method + path
  const pathParts = endpoint.path
    .split("/")
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("{") && part.endsWith("}")) {
        return (
          "By" + part.slice(1, -1).charAt(0).toUpperCase() + part.slice(2, -1)
        );
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    });

  const methodPrefix = endpoint.method.toLowerCase();
  return sanitizeIdentifier(methodPrefix + pathParts.join(""), "tool");
}

// Create tool config from endpoint
export function createToolConfig(endpoint: ParsedEndpoint): ToolConfig {
  // URL parameters (path, query, header)
  const urlParams = endpoint.parameters.map((p, index) => ({
    name: sanitizeIdentifier(p.name, `param_${index + 1}`),
    originalName: p.name,
    type: p.type,
    required: p.required,
    description: p.description || "",
    location: p.in as "path" | "query" | "header" | "cookie" | "body",
  }));

  // Request body parameters (for POST/PUT/PATCH)
  const bodyParams: ToolConfig["parameters"] = [];
  let bodySchema: Record<string, unknown> | undefined;
  let bodyContentType: string | undefined;
  let bodyExample: string | undefined;
  let description =
    endpoint.summary ||
    endpoint.description ||
    `${endpoint.method} ${endpoint.path}`;

  if (endpoint.requestBody?.schema) {
    const schema = endpoint.requestBody.schema as {
      type?: string;
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
      items?: Record<string, unknown>;
    };

    // Store the full schema
    bodySchema = endpoint.requestBody.schema;
    bodyContentType = endpoint.requestBody.contentType;

    // Generate example JSON
    const example = generateExampleFromSchema(endpoint.requestBody.schema);
    bodyExample = JSON.stringify(example, null, 2);

    const requiredFields = schema.required || [];

    const bodyKind = getBodyContentKind(
      {
        endpointId: endpoint.id,
        enabled: true,
        toolName: endpoint.operationId || endpoint.summary || endpoint.id,
        description,
        parameters: [],
        bodySchema,
        bodyContentType,
      },
      [],
    );
    const exposeProperties =
      (bodyKind === "flattenedObject" && isShallowSimpleObjectSchema(schema)) ||
      (["formUrlencoded", "multipart"].includes(bodyKind || "") &&
        Boolean(schema.properties));

    if (schema.properties && exposeProperties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        bodyParams.push({
          name: sanitizeIdentifier(propName, `body_${bodyParams.length + 1}`),
          originalName: propName,
          type: getTypeFromSchema(propSchema),
          required: requiredFields.includes(propName),
          description: [
            (propSchema.description as string) || "",
            bodyKind === "multipart" && isBinarySchema(propSchema)
              ? "Base64-encoded file content."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          location: "body",
          schema: propSchema,
        });
      }
    } else if (bodyKind) {
      bodyParams.push({
        name: "body",
        originalName: "body",
        type: getTypeFromSchema(schema),
        required: endpoint.requestBody.required,
        description:
          schema.type === "array" ? "Request body array" : "Request body",
        location: "body",
        schema: schema,
      });
    }
  }

  // Build enhanced description with example if available
  if (bodyExample && bodyParams.length > 0) {
    description = `${description}\n\nRequest body example:\n${bodyExample}`;
  }

  return {
    endpointId: endpoint.id,
    enabled: false,
    toolName: generateToolName(endpoint),
    description: description.slice(0, 8000),
    parameters: [...urlParams, ...bodyParams],
    bodySchema,
    bodyContentType,
    bodyExample,
  };
}
