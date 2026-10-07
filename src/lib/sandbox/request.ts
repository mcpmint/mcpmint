import { expectedPathParameter, expectedSerializedParameterValue, getExpectedQueryEntries } from "../generator/targets/shared.ts";
import type { GenerationTool } from "@/lib/generator/types";

export interface InspectedHttpRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    bodyKind?: "binary" | "multipart";
    multipart?: Array<{ name: string; value: string; binary: boolean }>;
}

export interface McpSandboxResponse {
    isError: boolean;
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    http: { status: number; statusText: string; durationMs?: number; mode: "mock" | "live" };
}

function asObject(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function scalar(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null) return "null";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function requiredArguments(tool: GenerationTool, args: Record<string, unknown>): void {
    const missing = tool.params
        .filter((parameter) => parameter.required && args[parameter.argName] === undefined)
        .map((parameter) => parameter.argName);
    if (missing.length > 0) throw new Error(`Missing required argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
}

export function inspectToolRequest(tool: GenerationTool, baseUrl: string, input: unknown): InspectedHttpRequest {
    const args = asObject(input);
    requiredArguments(tool, args);
    let path = tool.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { Accept: "application/json" };
    const cookies: string[] = [];

    for (const parameter of tool.params) {
        const value = args[parameter.argName];
        if (value === undefined) continue;
        if (parameter.location === "path") {
            path = path.replace(`{${parameter.sourceName}}`, expectedPathParameter(parameter.sourceName, value, parameter));
        } else if (parameter.location === "query") {
            // Canonical query serialization is applied once below.
        } else if (parameter.location === "header") {
            headers[parameter.sourceName] = expectedSerializedParameterValue(parameter.sourceName, value, { ...parameter, location: parameter.location });
        } else if (parameter.location === "cookie") {
            cookies.push(`${encodeURIComponent(parameter.sourceName)}=${encodeURIComponent(expectedSerializedParameterValue(parameter.sourceName, value, { ...parameter, location: parameter.location }))}`);
        }
    }

    for (const [name, value] of getExpectedQueryEntries(tool, args)) query.append(name, value);
    if (/\{[^}]+\}/.test(path)) throw new Error(`Unresolved path parameter in ${path}`);
    if (cookies.length > 0) headers.Cookie = cookies.join("; ");
    const normalizedBase = (tool.baseUrl || baseUrl).replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${normalizedBase}${normalizedPath}${query.size > 0 ? `?${query.toString()}` : ""}`;

    const bodyParameters = tool.params.filter((parameter) => parameter.location === "body" && args[parameter.argName] !== undefined);
    let body: string | undefined;
    let bodyKind: InspectedHttpRequest["bodyKind"];
    let multipart: InspectedHttpRequest["multipart"];
    if (tool.requestBody && bodyParameters.length > 0) {
        const bodyValues = Object.fromEntries(bodyParameters.map((parameter) => [parameter.sourceName, args[parameter.argName]]));
        const onlyBody = ["rawJsonObject", "rawArray", "text", "binary"].includes(tool.requestBody.contentKind);
        const bodyValue = onlyBody ? args[bodyParameters[0].argName] : bodyValues;
        if (tool.requestBody.contentKind === "binary") {
            body = String(bodyValue);
            bodyKind = "binary";
        } else if (tool.requestBody.contentKind === "multipart") {
            bodyKind = "multipart";
            multipart = bodyParameters.map((p) => ({ name: p.sourceName, value: String(args[p.argName]), binary: p.schema?.format === "binary" || p.schema?.type === "file" }));
            body = "Multipart fields are shown below; the HTTP client creates the boundary. Binary values are base64-encoded.";
        } else if (tool.requestBody.contentKind === "formUrlencoded") {
            body = new URLSearchParams(Object.entries(bodyValues).map(([key, value]) => [key, scalar(value)])).toString();
        } else if (tool.requestBody.contentKind === "text") {
            body = scalar(bodyValue);
        } else {
            body = JSON.stringify(bodyValue, null, 2);
        }
        if (bodyKind !== "multipart") headers["Content-Type"] = tool.requestBody.contentType;
    }

    return { method: tool.method, url, headers, body, ...(bodyKind ? { bodyKind } : {}), ...(multipart ? { multipart } : {}) };
}

function exampleForSchema(schema: Record<string, unknown> | undefined): unknown {
    if (!schema) return "sample";
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    if (schema.type === "integer" || schema.type === "number") return 1;
    if (schema.type === "boolean") return true;
    if (schema.type === "array") return [exampleForSchema(asObject(schema.items))];
    if (schema.type === "object" || schema.properties) {
        return Object.fromEntries(Object.entries(asObject(schema.properties)).map(([key, value]) => [key, exampleForSchema(asObject(value))]));
    }
    if (schema.format === "binary") return "ZmlsZSBjb250ZW50";
    if (schema.format === "email") return "user@example.com";
    if (schema.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
    if (schema.format === "date") return "2026-07-20";
    return "sample";
}

export function sampleArguments(tool: GenerationTool): Record<string, unknown> {
    return Object.fromEntries(tool.params
        .filter((parameter) => parameter.required)
        .map((parameter) => [parameter.argName, exampleForSchema(parameter.schema)]));
}

export function createMockMcpResponse(status: number, body: unknown): McpSandboxResponse {
    const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    return {
        isError: status < 200 || status >= 300,
        content: [{ type: "text", text }],
        ...(typeof body === "object" && body !== null && !Array.isArray(body) ? { structuredContent: body as Record<string, unknown> } : {}),
        http: { status, statusText: status >= 200 && status < 300 ? "Mock success" : "Mock error", mode: "mock" },
    };
}

export async function executeInspectedRequest(request: InspectedHttpRequest, expectedOrigin: string): Promise<McpSandboxResponse> {
    const url = new URL(request.url);
    if (url.origin !== new URL(expectedOrigin).origin) {
        throw new Error("Live tests are restricted to the imported specification's base origin.");
    }
    if (typeof window !== "undefined") throw new Error("Live testing runs locally through the CLI or generated server. Browser inspection and mocks do not send API requests.");
    let body: BodyInit | undefined = request.body;
    if (request.bodyKind === "binary") body = Uint8Array.from(atob(request.body || ""), (c) => c.charCodeAt(0));
    if (request.bodyKind === "multipart") {
        const form = new FormData();
        for (const part of request.multipart || []) {
            if (part.binary) form.append(part.name, new Blob([Uint8Array.from(atob(part.value), (c) => c.charCodeAt(0))]), part.name);
            else form.append(part.name, part.value);
        }
        body = form;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const started = performance.now();
    try {
        const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : body,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
        });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        let bytes = 0;
        if (reader) {
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    bytes += chunk.value.byteLength;
                    if (bytes > 262_144) throw new Error("Live response exceeded the 256 KiB sandbox limit.");
                    raw += decoder.decode(chunk.value, { stream: true });
                }
                raw += decoder.decode();
            } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        }
        let parsed: unknown = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { /* text response */ }
        const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
        return {
            isError: !response.ok,
            content: [{ type: "text", text }],
            ...(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { structuredContent: parsed as Record<string, unknown> } : {}),
            http: {
                status: response.status,
                statusText: response.statusText,
                durationMs: Math.round(performance.now() - started),
                mode: "live",
            },
        };
    } finally {
        clearTimeout(timeout);
    }
}
