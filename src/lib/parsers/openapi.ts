import { resolveLocalReferences } from "./local-references.ts";
import { assertTextSize, assertGraphBudget, MAX_OPERATIONS } from "../processing/limits.ts";
import type { ParsedSpec } from "../api-model/parsed-spec.ts";
import { buildOpenAPIModel } from "../api-model/openapi.ts";
import type { OpenAPISpec } from "../api-model/openapi.ts";
import { apiModelToParsedSpec } from "../api-model/legacy.ts";

// Parse OpenAPI/Swagger spec
export async function parseOpenAPISpec(input: string | object): Promise<ParsedSpec> {
    try {
        const api = resolveLocalReferences(typeof input === "string" ? JSON.parse(input) : input) as OpenAPISpec;
        if (!(typeof api.openapi === "string" && /^3\.\d+\.\d+$/.test(api.openapi)) && api.swagger !== "2.0") {
            throw new Error("Choose an OpenAPI 3.x or Swagger 2.0 specification.");
        }
        if (typeof api.info?.title !== "string" || typeof api.info?.version !== "string") {
            throw new Error("The specification needs info.title and info.version strings.");
        }
        return apiModelToParsedSpec(buildOpenAPIModel(api, {
            importedFrom: typeof input === "string" ? input : undefined,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse OpenAPI spec";
        throw new Error(`OpenAPI parsing error: ${message}`);
    }
}

// Parse from file content - supports both OpenAPI and Postman
export async function parseOpenAPIFromContent(content: string, filename: string): Promise<ParsedSpec & { format?: string }> {
    assertTextSize(content);
    try {
        // Try to parse as JSON first
        let parsed: object;
        try {
            parsed = JSON.parse(content);
        } catch {
            // Try YAML
            const yaml = await import("yaml");
            parsed = yaml.parse(content);
        }

        assertGraphBudget(parsed);

        // Detect format and parse accordingly
        const { isPostmanCollection, parsePostmanCollection } = await import("./postman.ts");

        if (isPostmanCollection(parsed)) {
            const spec = parsePostmanCollection(parsed);
            if (spec.apiModel!.operations.length > MAX_OPERATIONS) throw new Error(`Specifications are limited to ${MAX_OPERATIONS.toLocaleString()} operations.`);
            return { ...spec, format: "postman" };
        }

        // Default to OpenAPI
        const spec = await parseOpenAPISpec(parsed);
        if (spec.apiModel!.operations.length > MAX_OPERATIONS) throw new Error(`Specifications are limited to ${MAX_OPERATIONS.toLocaleString()} operations.`);
        return { ...spec, format: "openapi" };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse file";
        throw new Error(`Failed to parse ${filename}: ${message}`);
    }
}

// Parse from URL.
//
// The raw fetch happens SERVER-SIDE via the /api/fetch-spec proxy (which is
// SSRF-hardened) to avoid browser CORS failures. Once we have the text we run
// it through the SAME client-side pipeline as the file/paste tabs, so OpenAPI,
// Swagger AND Postman collections all work identically regardless of source.
export async function parseOpenAPIFromURL(url: string): Promise<ParsedSpec & { format?: string }> {
    let content: string;
    try {
        const response = await fetch("/api/fetch-spec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        const data = (await response.json().catch(() => null)) as
            | { content?: string; error?: string }
            | null;

        if (!response.ok || !data || typeof data.content !== "string") {
            const message = data?.error || `Failed to fetch spec (HTTP ${response.status})`;
            throw new Error(message);
        }

        content = data.content;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch spec";
        throw new Error(`Failed to fetch from ${url}: ${message}`);
    }

    // Reuse the shared detect-and-parse pipeline (handles Postman vs OpenAPI).
    return parseOpenAPIFromContent(content, url);
}

export * from "./validation.ts";
