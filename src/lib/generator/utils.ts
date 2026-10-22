import type {
    GenerationFeatureFlags,
    GeneratorExportConfig,
    GeneratorToolConfig,
    ParamLocation,
    RequestBodyContentKind,
    Transport,
    TransportStrategy,
} from "./types.ts";

export function toSafeIdentifier(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const safeValue = normalized || fallback;
    return /^[a-zA-Z_]/.test(safeValue) ? safeValue : `${fallback}_${safeValue}`;
}

export function makeUniqueIdentifier(
    desired: string,
    existing: Set<string>,
    fallback: string
): string {
    const base = toSafeIdentifier(desired, fallback);

    if (!existing.has(base)) {
        existing.add(base);
        return base;
    }

    let counter = 2;
    while (existing.has(`${base}_${counter}`)) {
        counter += 1;
    }

    const unique = `${base}_${counter}`;
    existing.add(unique);
    return unique;
}

export function toJsStringLiteral(str: string): string {
    if (!str) return '""';

    // Mirror Python escaping: remaining C0 controls become \xHH so emitted
    // TypeScript source stays clean for tooling (and matches hardening tests).
    const escaped = str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (char) =>
            `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`
        );

    return `"${escaped}"`;
}

export function toPythonStringLiteral(str: string): string {
    if (!str) return '""';

    // \r must be escaped: Python treats a raw carriage return as a line
    // terminator, so a CRLF inside a single-line "..." literal is a SyntaxError.
    // Remaining C0 controls are escaped too: a raw NUL is a hard SyntaxError
    // ("source code string cannot contain null bytes"), and VT/FF/ESC etc. are
    // corruption-prone in emitted source.
    const escaped = str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);

    return `"${escaped}"`;
}

function hasSchemaComposition(schema: Record<string, unknown>): boolean {
    return Boolean(schema.oneOf || schema.anyOf || schema.allOf || Array.isArray(schema.type));
}

function isSimpleScalarSchema(schema: Record<string, unknown>): boolean {
    if (hasSchemaComposition(schema)) return false;
    if (schema.properties || schema.items || schema.additionalProperties) return false;

    if (Array.isArray(schema.enum)) {
        return schema.enum.every((value) =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            value === null
        );
    }

    return ["string", "number", "integer", "boolean"].includes(String(schema.type || ""));
}

export function isBinarySchema(schema?: Record<string, unknown>): boolean {
    return schema?.format === "binary" || schema?.type === "file";
}

export function isShallowSimpleObjectSchema(schema?: Record<string, unknown>): boolean {
    if (!schema || hasSchemaComposition(schema)) return false;
    if (schema.type && schema.type !== "object") return false;
    if (schema.additionalProperties) return false;
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return false;

    const properties = schema.properties as Record<string, Record<string, unknown>>;
    return Object.values(properties).every(isSimpleScalarSchema);
}

function isJsonContentType(contentType: string): boolean {
    return contentType.includes("application/json") || contentType.includes("+json");
}

export function getBodyContentKind(
    tool: GeneratorToolConfig,
    params: { location: ParamLocation; sourceName: string }[]
): RequestBodyContentKind | undefined {
    const bodyParams = params.filter((param) => param.location === "body");
    if (bodyParams.length === 0 && !tool.bodySchema) {
        return undefined;
    }

    const contentType = (tool.bodyContentType || "application/json").toLowerCase();
    const schema = tool.bodySchema;

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return "formUrlencoded";
    }

    if (contentType.includes("multipart/form-data")) {
        return "multipart";
    }

    if (contentType.startsWith("text/")) {
        return "text";
    }

    if (
        contentType.includes("application/octet-stream") ||
        contentType.includes("application/pdf") ||
        contentType.startsWith("image/")
    ) {
        return "binary";
    }

    if (schema?.format === "binary") {
        return "binary";
    }

    if (!isJsonContentType(contentType)) {
        return undefined;
    }

    if (schema?.type === "array") {
        return "rawArray";
    }

    if (isShallowSimpleObjectSchema(schema)) {
        return "flattenedObject";
    }

    if (schema) {
        return "rawJsonObject";
    }

    if (bodyParams.length === 1 && bodyParams[0].sourceName === "body") {
        return "rawJsonObject";
    }

    return "flattenedObject";
}

export function getTransportStrategy(transport: Transport): TransportStrategy {
    if (transport === "http") {
        return "streamableHttp";
    }

    return transport;
}

export function getDefaultFeatures(exportConfig: GeneratorExportConfig): GenerationFeatureFlags {
    return {
        documentation: exportConfig.features?.documentation ?? true,
        docker: exportConfig.features?.docker ?? false,
        tests: exportConfig.features?.tests ?? true,
        // Process-spawning verification is opt-in; default off so public and
        // client paths do not pay tsc/npm cost unless the user enables it.
        verification: exportConfig.features?.verification ?? false,
    };
}
