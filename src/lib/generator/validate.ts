import type {
    GenerationIssue,
    GenerationPlan,
    ValidationResult,
} from "./types.ts";

function pushIssue(
    collection: GenerationIssue[],
    severity: GenerationIssue["severity"],
    message: string,
    path?: string
) {
    collection.push({ severity, message, path });
}

export function validateGenerationPlan(plan: GenerationPlan): ValidationResult {
    const errors: GenerationIssue[] = [];
    const warnings: GenerationIssue[] = [];
    const info: GenerationIssue[] = [];

    if (!plan.server.name.trim()) {
        pushIssue(errors, "error", "Server name is required", "server.name");
    }

    if (!plan.server.version.trim()) {
        pushIssue(errors, "error", "Server version is required", "server.version");
    }

    if (!plan.server.host.trim()) {
        pushIssue(errors, "error", "Server host is required", "server.host");
    }

    if (!Number.isInteger(plan.server.port) || plan.server.port <= 0 || plan.server.port > 65535) {
        pushIssue(errors, "error", "Server port must be between 1 and 65535", "server.port");
    }

    if (plan.tools.length === 0) {
        pushIssue(errors, "error", "At least one tool must be selected", "tools");
    }

    const displayNames = new Set<string>();
    for (const tool of plan.tools) {
        if (tool.baseUrl) {
            try {
                const url = new URL(tool.baseUrl);
                if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("unsupported URL");
            } catch {
                pushIssue(errors, "error", "Operation server must resolve to an absolute HTTP(S) URL without embedded credentials.", tool.id);
            }
        }
        if (!tool.displayName.trim()) {
            pushIssue(errors, "error", "Tool name is required", tool.id);
        }

        if (displayNames.has(tool.displayName)) {
            pushIssue(errors, "error", `Duplicate MCP tool name "${tool.displayName}"`, tool.id);
        } else {
            displayNames.add(tool.displayName);
        }

        const args = new Set<string>();
        for (const parameter of tool.params) {
            if (args.has(parameter.argName)) {
                pushIssue(errors, "error", `Duplicate parameter identifier "${parameter.argName}"`, tool.id);
            } else {
                args.add(parameter.argName);
            }

            if (parameter.location === "path" && !tool.path.includes(`{${parameter.sourceName}}`)) {
                pushIssue(warnings, "warning", `Path parameter "${parameter.sourceName}" does not appear in path "${tool.path}"`, tool.id);
            }
        }

        if (tool.requestBody && !["POST", "PUT", "PATCH"].includes(tool.method)) {
            pushIssue(warnings, "warning", `Body parameters are unusual for ${tool.method} ${tool.path}`, tool.id);
        }

        if (tool.requestBody?.contentKind === "text" && tool.requestBody.params.length > 1) {
            pushIssue(warnings, "warning", `Text request bodies should usually map to a single argument`, tool.id);
        }

        if (tool.requestBody?.contentKind === "binary" && tool.requestBody.params.length > 1) {
            pushIssue(warnings, "warning", `Binary request bodies should usually map to a single argument`, tool.id);
        }
    }

    if (plan.auth.type === "apiKey" && !plan.auth.apiKeyName?.trim()) {
        pushIssue(errors, "error", "API key auth requires a parameter name", "auth.apiKeyName");
    }

    if (plan.runtime.transport !== "stdio" && plan.mcpServerAuth.type === "none") {
        pushIssue(warnings, "warning", "HTTP/SSE MCP server access has no bearer token configured. Bind to localhost, or select bearer auth and set MCP_AUTH_TOKEN before exposing this server.", "mcpServerAuth.type");
    }

    if (plan.runtime.transport !== "stdio" && plan.server.host === "0.0.0.0" && plan.mcpServerAuth.type === "none") {
        pushIssue(warnings, "warning", "Server host is 0.0.0.0 and MCP server access auth is none. This can expose the MCP server to the network.", "server.host");
    }

    if (!plan.features.documentation) {
        pushIssue(info, "info", "README generation disabled", "features.documentation");
    }

    if (!plan.features.verification) {
        pushIssue(info, "info", "Post-generation verification disabled", "features.verification");
    }

    for (const warning of plan.warnings) {
        pushIssue(info, "info", warning);
    }

    return { errors, warnings, info };
}
