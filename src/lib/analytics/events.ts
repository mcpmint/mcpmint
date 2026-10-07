export const analyticsEvents = ["$pageview", "import_started", "import_succeeded", "import_failed", "selection_completed", "preview_succeeded", "preview_failed", "generation_succeeded", "generation_failed", "installation_instructions_copied", "first_tool_call_completed"] as const;
export type AnalyticsEvent = typeof analyticsEvents[number];
const routes = ["/", "/import", "/editor", "/export", "/guide", "/privacy"];
const enums: Record<string, readonly string[]> = {
    route: routes, source: ["file", "paste", "url", "sample", "project"], format: ["openapi", "postman", "unknown"],
    language: ["node", "python"], transport: ["stdio", "http", "sse"], execution: ["browser", "server"],
    tool_count: ["0", "1-5", "6-25", "26-100", "100+"], client: ["claude-desktop", "claude-code", "cursor", "vscode"],
    instruction: ["registration", "connection_check"], confirmation: ["self_reported"],
};
const fields: Record<AnalyticsEvent, readonly string[]> = {
    "$pageview": ["route"], import_started: ["source"], import_succeeded: ["source", "format", "duration_ms"], import_failed: ["source", "duration_ms"],
    selection_completed: ["tool_count"], preview_succeeded: ["language", "transport", "execution", "duration_ms"], preview_failed: ["language", "transport", "execution", "duration_ms"],
    generation_succeeded: ["language", "transport", "execution", "compact", "tool_count", "duration_ms"], generation_failed: ["language", "transport", "execution", "duration_ms"],
    installation_instructions_copied: ["client", "language", "transport", "instruction"], first_tool_call_completed: ["client", "language", "transport", "confirmation"],
};
export function knownRoute(path: string): string | undefined { return routes.includes(path) ? path : undefined; }
export function toolCountBucket(count: number): string { return count <= 0 ? "0" : count <= 5 ? "1-5" : count <= 25 ? "6-25" : count <= 100 ? "26-100" : "100+"; }
/** No free-text property is accepted, even if a future caller passes a spec or error. */
export function analyticsProperties(event: AnalyticsEvent, input: Record<string, unknown>): Record<string, string | number | boolean> {
    const output: Record<string, string | number | boolean> = {};
    for (const key of fields[event]) {
        const value = input[key];
        if (enums[key]?.includes(value as string)) output[key] = value as string;
        else if (key === "compact" && typeof value === "boolean") output[key] = value;
        else if (key === "duration_ms" && typeof value === "number" && Number.isFinite(value) && value >= 0) output[key] = Math.min(3_600_000, Math.round(value));
    }
    return output;
}
/** Strip SDK-added URLs, referrers, person properties and all unapproved event types. */
export function sanitizeAnalyticsEvent<T extends { event: string; properties: Record<string, unknown> }>(event: T | null): (Omit<T, "properties"> & { properties: Record<string, unknown> }) | null {
    if (!event || !analyticsEvents.includes(event.event as AnalyticsEvent)) return null;
    const properties: Record<string, unknown> = analyticsProperties(event.event as AnalyticsEvent, event.properties);
    for (const key of ["distinct_id", "token", "$lib", "$lib_version", "$device_id", "$session_id", "$window_id"]) {
        const value = event.properties[key];
        if (typeof value === "string" && /^[a-zA-Z0-9._-]{1,200}$/.test(value)) properties[key] = value;
    }
    properties.$process_person_profile = false;
    properties.$geoip_disable = true;
    const sanitized = { ...event, properties };
    for (const field of ["$set", "$set_once", "$unset"]) delete (sanitized as Record<string, unknown>)[field];
    return sanitized;
}
