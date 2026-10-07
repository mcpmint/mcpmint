import type { GenerationPlan } from "./types.ts";
import { collectAuthSchemes } from "./strategies/auth.ts";

export function mcpEndpointUrl(language: "node" | "python", transport: "http" | "sse" | "stdio", host: string, port: number): string {
    const clientHost = ["0.0.0.0", "::", "[::]"].includes(host) ? "localhost" : host;
    const hostname = clientHost.includes(":") && !clientHost.startsWith("[") ? `[${clientHost}]` : clientHost;
    const path = transport === "sse" ? "/sse" : language === "python" ? "/mcp" : "";
    return `http://${hostname}:${port}${path}`;
}

export function installationMetadata(plan: GenerationPlan) {
    const authEnv: Record<string, string> = {};
    for (const scheme of collectAuthSchemes(plan)) {
        for (const name of [scheme.apiKeyEnvVar, scheme.bearerTokenEnvVar, scheme.basicUsernameEnvVar, scheme.basicPasswordEnvVar]) {
            if (name) authEnv[name] = "replace_with_your_upstream_credential";
        }
    }
    return { authEnv, mcpAuthType: plan.mcpServerAuth.type };
}
