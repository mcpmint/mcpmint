import type { GenerationPlan, ToolAuthSchemePlan } from "../types.ts";

export interface AuthSchemeEnvironmentConfig {
    key: string;
    scheme: ToolAuthSchemePlan;
    apiKeyEnvVar?: string;
    bearerTokenEnvVar?: string;
    basicUsernameEnvVar?: string;
    basicPasswordEnvVar?: string;
}

function toEnvIdentifier(value: string): string {
    const normalized = value
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    const safe = normalized || "AUTH";
    return /^[0-9]/.test(safe) ? `AUTH_${safe}` : safe;
}

export function getAuthSchemeKey(scheme: ToolAuthSchemePlan): string {
    return [
        scheme.schemeName,
        scheme.strategy,
        scheme.apiKeyLocation || "",
        scheme.apiKeyName || "",
    ].join(":");
}

function makeUniqueEnvVar(desired: string, seen: Set<string>): string {
    if (!seen.has(desired)) {
        seen.add(desired);
        return desired;
    }

    let counter = 2;
    while (seen.has(`${desired}_${counter}`)) {
        counter += 1;
    }

    const unique = `${desired}_${counter}`;
    seen.add(unique);
    return unique;
}

function getDesiredEnvVars(scheme: ToolAuthSchemePlan): Omit<AuthSchemeEnvironmentConfig, "key" | "scheme"> {
    const base = toEnvIdentifier(scheme.schemeName);

    if (scheme.strategy === "apiKeyHeader" || scheme.strategy === "apiKeyQuery" || scheme.strategy === "apiKeyCookie") {
        return { apiKeyEnvVar: scheme.schemeName === "apiKey" ? "API_KEY" : `${base}_API_KEY` };
    }

    if (scheme.strategy === "bearer") {
        return { bearerTokenEnvVar: scheme.schemeName === "bearer" ? "BEARER_TOKEN" : `${base}_TOKEN` };
    }

    return {
        basicUsernameEnvVar: scheme.schemeName === "basic" ? "BASIC_USERNAME" : `${base}_USERNAME`,
        basicPasswordEnvVar: scheme.schemeName === "basic" ? "BASIC_PASSWORD" : `${base}_PASSWORD`,
    };
}

export function collectAuthSchemes(plan: GenerationPlan): AuthSchemeEnvironmentConfig[] {
    const byKey = new Map<string, ToolAuthSchemePlan>();

    for (const tool of plan.tools) {
        for (const requirement of tool.authStrategy.requirements || []) {
            for (const scheme of requirement.schemes) {
                byKey.set(getAuthSchemeKey(scheme), scheme);
            }
        }
    }

    const seenEnvVars = new Set<string>();
    return Array.from(byKey.entries()).map(([key, scheme]) => {
        const desired = getDesiredEnvVars(scheme);
        return {
            key,
            scheme,
            apiKeyEnvVar: desired.apiKeyEnvVar ? makeUniqueEnvVar(desired.apiKeyEnvVar, seenEnvVars) : undefined,
            bearerTokenEnvVar: desired.bearerTokenEnvVar ? makeUniqueEnvVar(desired.bearerTokenEnvVar, seenEnvVars) : undefined,
            basicUsernameEnvVar: desired.basicUsernameEnvVar ? makeUniqueEnvVar(desired.basicUsernameEnvVar, seenEnvVars) : undefined,
            basicPasswordEnvVar: desired.basicPasswordEnvVar ? makeUniqueEnvVar(desired.basicPasswordEnvVar, seenEnvVars) : undefined,
        };
    });
}
