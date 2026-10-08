import { readResponseCapped } from "./read-response.ts";
import type { GenerationParam, GenerationTool } from "@/lib/generator/types";

export interface InspectedHttpRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
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

function simpleValue(value: unknown, explode = false): string {
    if (Array.isArray(value)) return value.map(scalar).join(",");
    if (typeof value === "object" && value !== null) {
        return Object.entries(value)
            .flatMap(([key, item]) => explode ? [`${key}=${scalar(item)}`] : [key, scalar(item)])
            .join(",");
    }
    return scalar(value);
}

function pathValue(parameter: GenerationParam, value: unknown): string {
    const style = parameter.style || "simple";
    const serialized = simpleValue(value, parameter.explode);
    if (style === "label") return `.${serialized}`;
    if (style === "matrix") {
        if (parameter.explode && typeof value === "object" && value !== null) {
            return `;${Object.entries(value).map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(scalar(item))}`).join(";")}`;
        }
        return `;${encodeURIComponent(parameter.sourceName)}=${serialized}`;
    }
    return serialized;
}

function appendQuery(query: URLSearchParams, parameter: GenerationParam, value: unknown): void {
    const style = parameter.style || "form";
    if (style === "deepObject" && typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const [key, item] of Object.entries(value)) query.append(`${parameter.sourceName}[${key}]`, scalar(item));
        return;
    }
    if (Array.isArray(value) && style === "form" && parameter.explode !== false) {
        for (const item of value) query.append(parameter.sourceName, scalar(item));
        return;
    }
    const delimiter = style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    if (Array.isArray(value)) query.append(parameter.sourceName, value.map(scalar).join(delimiter));
    else query.append(parameter.sourceName, simpleValue(value, parameter.explode));
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
            path = path.replace(`{${parameter.sourceName}}`, encodeURIComponent(pathValue(parameter, value)));
        } else if (parameter.location === "query") {
            appendQuery(query, parameter, value);
        } else if (parameter.location === "header") {
            headers[parameter.sourceName] = simpleValue(value, parameter.explode);
        } else if (parameter.location === "cookie") {
            cookies.push(`${encodeURIComponent(parameter.sourceName)}=${encodeURIComponent(simpleValue(value, parameter.explode))}`);
        }
    }

    if (/\{[^}]+\}/.test(path)) throw new Error(`Unresolved path parameter in ${path}`);
    if (cookies.length > 0) headers.Cookie = cookies.join("; ");
    const normalizedBase = baseUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${normalizedBase}${normalizedPath}${query.size > 0 ? `?${query.toString()}` : ""}`;

    const bodyParameters = tool.params.filter((parameter) => parameter.location === "body" && args[parameter.argName] !== undefined);
    let body: string | undefined;
    if (tool.requestBody && bodyParameters.length > 0) {
        const bodyValues = Object.fromEntries(bodyParameters.map((parameter) => [parameter.sourceName, args[parameter.argName]]));
        const onlyBody = bodyParameters.length === 1 && bodyParameters[0].argName === "body";
        const bodyValue = onlyBody ? args.body : bodyValues;
        if (tool.requestBody.contentKind === "formUrlencoded") {
            body = new URLSearchParams(Object.entries(bodyValues).map(([key, value]) => [key, scalar(value)])).toString();
        } else if (tool.requestBody.contentKind === "text") {
            body = scalar(bodyValue);
        } else {
            body = JSON.stringify(bodyValue, null, 2);
        }
        headers["Content-Type"] = tool.requestBody.contentType;
    }

    return { method: tool.method, url, headers, body };
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

export async function executeInspectedRequest(request: InspectedHttpRequest, expectedOrigin: string, signal?: AbortSignal): Promise<McpSandboxResponse> {
    const url = new URL(request.url);
    if (url.origin !== new URL(expectedOrigin).origin) {
        throw new Error("Live tests are restricted to the imported specification's base origin.");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const started = performance.now();
    try {
        const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
        });
        const raw = await readResponseCapped(response);
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
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error("The live request timed out after 10 seconds.");
        if (error instanceof TypeError) throw new Error("The browser could not reach this API. Check its HTTPS URL and CORS settings, or test it from the exported server.");
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
    }
}
