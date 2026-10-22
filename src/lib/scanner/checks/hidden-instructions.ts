import type { Finding, ScanTool, Severity } from "../types.ts";

const INSTRUCTION_PHRASE =
    /ignore (all|any|previous)|do not (tell|reveal|mention)|you must|always (send|include|forward)/i;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/u;
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/u;
const TAG_CHARACTER = /[\u{E0000}-\u{E007F}]/u;
const HTML_COMMENT = /<!--([\s\S]*?)-->/g;
const BASE64_BLOB = /[A-Za-z0-9+/=]{60,}/g;

interface TextLocation {
    text: string;
    label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCHEMA_BRANCHES = ["anyOf", "oneOf", "allOf"] as const;
const MAX_SCHEMA_DEPTH = 32;

// Collect description and title text from every schema the tool emits,
// including union branches, array items and additionalProperties.
function collectSchemaText(schema: unknown): TextLocation[] {
    const locations: TextLocation[] = [];

    function visit(value: unknown, path: string[], depth: number): void {
        if (!isRecord(value) || depth > MAX_SCHEMA_DEPTH) return;
        if (path.length > 0) {
            const label = `inputSchema property "${path.join(".")}"`;
            if (typeof value.description === "string") locations.push({ text: value.description, label });
            if (typeof value.title === "string") locations.push({ text: value.title, label });
        }
        if (isRecord(value.properties)) {
            for (const [name, propertySchema] of Object.entries(value.properties)) {
                visit(propertySchema, [...path, name], depth + 1);
            }
        }
        if (isRecord(value.items)) visit(value.items, path, depth + 1);
        if (isRecord(value.additionalProperties)) visit(value.additionalProperties, path, depth + 1);
        for (const branch of SCHEMA_BRANCHES) {
            const options = value[branch];
            if (Array.isArray(options)) for (const option of options) visit(option, path, depth + 1);
        }
    }

    visit(schema, [], 0);
    return locations;
}

function isMostlyPrintableInstruction(blob: string): boolean {
    try {
        const decoded = globalThis.atob(blob);
        if (decoded.length === 0) return false;
        let printable = 0;
        for (let index = 0; index < decoded.length; index += 1) {
            const byte = decoded.charCodeAt(index);
            if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
                printable += 1;
            }
        }
        return printable / decoded.length >= 0.85 && INSTRUCTION_PHRASE.test(decoded);
    } catch {
        return false;
    }
}

function finding(
    tool: ScanTool,
    severity: Severity,
    detail: string,
    location: TextLocation,
): Finding {
    return {
        check: "HIDDEN_INSTRUCTIONS",
        severity,
        toolName: tool.name,
        message: `${detail} in ${location.label} of "${tool.name}"`,
        parameterPath: location.label.startsWith("inputSchema property")
            ? location.label.match(/"([^"]+)"/)?.[1]
            : undefined,
        explanation: "Hidden or encoded text can conceal instructions from the person approving the tool while remaining visible to a model or parser.",
        remediation: "Remove the concealed content, rewrite the description as plain visible text, and review the source specification before exporting.",
        evidence: detail,
    };
}

function scanText(tool: ScanTool, location: TextLocation): Finding[] {
    const findings: Finding[] = [];
    if (ZERO_WIDTH.test(location.text)) {
        findings.push(finding(tool, "red", "zero-width characters hidden", location));
    }
    if (BIDI_CONTROL.test(location.text)) {
        findings.push(finding(tool, "red", "bidirectional control characters hidden", location));
    }
    if (TAG_CHARACTER.test(location.text)) {
        findings.push(finding(tool, "red", "Unicode tag characters hidden", location));
    }
    if (/\s{150,}(?=[\s\S]*\S)/u.test(location.text)) {
        findings.push(finding(tool, "red", "content hidden after 150 or more whitespace characters", location));
    } else if (/(?:\r?\n){8,}(?=[\s\S]*\S)/u.test(location.text)) {
        findings.push(finding(tool, "red", "content hidden after 8 or more consecutive newlines", location));
    }

    for (const match of location.text.matchAll(HTML_COMMENT)) {
        const instructionLike = INSTRUCTION_PHRASE.test(match[1]);
        findings.push(finding(
            tool,
            instructionLike ? "red" : "yellow",
            instructionLike ? "instruction-like HTML comment hidden" : "HTML comment hidden",
            location,
        ));
    }

    for (const match of location.text.matchAll(BASE64_BLOB)) {
        const instructionLike = isMostlyPrintableInstruction(match[0]);
        findings.push(finding(
            tool,
            instructionLike ? "red" : "yellow",
            instructionLike ? "base64 blob decodes to hidden instructions" : "base64-looking blob found",
            location,
        ));
    }
    return findings;
}

export function checkHiddenInstructions(tools: ScanTool[]): Finding[] {
    const findings: Finding[] = [];
    for (const tool of tools) {
        const locations: TextLocation[] = [];
        if (tool.description) locations.push({ text: tool.description, label: "description" });
        if (tool.title) locations.push({ text: tool.title, label: "title" });
        locations.push(...collectSchemaText(tool.inputSchema));
        for (const location of locations) findings.push(...scanText(tool, location));
    }
    return findings;
}
