import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createToolConfig, sanitizeToolConfig } from "@/lib/project-tools";
import { projectStorageKey, upsertProjectHistory } from "./project-history";
import {
    type PortableProjectFile,
    type ProjectSnapshotData,
} from "./project-file";
import type { CapabilityReport } from "@/lib/capabilities";
import type { PreparedImport } from "@/lib/processing/types";
import { runProcessing } from "@/lib/processing/client";
import { createProjectStorage, readStored, writeStored, removeStored } from "@/lib/project-storage";
import { MAX_SELECTED_TOOLS } from "@/lib/processing/limits";
import { diffSpecs, type SpecDiff } from "@/lib/spec-diff";

// Parsed API spec types now live in the lib layer (api-model). Re-exported here
// so existing store consumers keep importing them from the store unchanged.
export type { ParsedParameter, ParsedEndpoint, ParsedSpec } from "@/lib/api-model/parsed-spec";
import type { ParsedSpec } from "@/lib/api-model/parsed-spec";

// Tool configuration
export interface ToolConfig {
    endpointId: string;
    enabled: boolean;
    toolName: string;
    description: string;
    parameters: {
        name: string;
        originalName: string;
        type: string;
        required: boolean;
        description: string;
        location: "path" | "query" | "header" | "cookie" | "body";
        // For nested objects, store the full schema
        schema?: Record<string, unknown>;
        hidden?: boolean;
    }[];
    // Full request body schema (resolved)
    bodySchema?: Record<string, unknown>;
    bodyContentType?: string;
    // Example request body JSON
    bodyExample?: string;
}

// Auth configuration
export interface AuthConfig {
    type: "apiKey" | "bearer" | "basic" | "none";
    apiKey?: {
        name: string;
        in: "header" | "query" | "cookie";
    };
}

export interface McpServerAuthConfig {
    type: "none" | "bearer";
    allowedOrigins: string[];
}

// Server configuration
export interface ServerConfig {
    name: string;
    version: string;
    host: string;
    port: number;
    transport: "stdio" | "sse" | "http";
}

// Export configuration
export interface ExportConfig {
    language: "node" | "python";
    framework: "mcp-ts-sdk" | "fastmcp";
    packageManager: "npm" | "pnpm" | "yarn";
    verificationMode: "fast" | "full";
    // Compact mode (meta-tools). When true the generated server exposes just
    // three meta-tools (list_api_endpoints / get_api_endpoint_schema /
    // invoke_api_endpoint) instead of one tool per operation, which keeps large
    // APIs from bloating the model's context window. Matches the generator's
    // `compactMode` field on the export config.
    compactMode: boolean;
    features: {
        documentation: boolean;
        docker: boolean;
        tests: boolean;
        verification: boolean;
    };
}

type ExportConfigUpdate = Partial<Omit<ExportConfig, "features">> & {
    features?: Partial<ExportConfig["features"]>;
};

type PersistedProjectState = Partial<ProjectState>;

// Saved project for history
export interface SavedProject {
    id: string;
    name: string;
    source: string;
    format: string;
    endpointCount: number;
    savedAt: number;
}

export interface DeletedProject {
    project: SavedProject;
    data: ProjectSnapshotData;
}

// Project state
export interface ProjectState {
    // Current step
    currentStep: "import" | "editor" | "export";

    // Parsed spec
    spec: ParsedSpec | null;
    specSource: string | null; // filename or URL
    specFormat: string | null; // openapi or postman
    activeProjectId: string | null;
    projectName: string;
    autosaveStatus: "idle" | "saving" | "saved" | "error";
    lastSavedAt: number | null;
    lastSpecDiff: SpecDiff | null;
    capabilityReport: CapabilityReport | null;
    endpointWarnings: PreparedImport["warnings"] | null;

    // Tool configurations
    tools: ToolConfig[];

    // Auth configuration
    authConfig: AuthConfig;

    // MCP server access configuration for HTTP/SSE transports
    mcpServerAuthConfig: McpServerAuthConfig;

    // Server configuration
    serverConfig: ServerConfig;

    // Export configuration
    exportConfig: ExportConfig;

    // Saved projects history
    savedProjects: SavedProject[];
    deletedProject: DeletedProject | null;

    // Loading states
    isLoading: boolean;
    error: string | null;

    // Actions
    setSpec: (spec: ParsedSpec, source: string, prepared?: PreparedImport) => void;
    regenerateSpec: (spec: ParsedSpec, source: string, prepared?: PreparedImport) => SpecDiff | null;
    clearSpec: () => void;
    setCurrentStep: (step: "import" | "editor" | "export") => void;

    // Tool actions
    toggleTool: (endpointId: string) => void;
    setToolsEnabled: (ids: string[], enabled: boolean, replace?: boolean) => void;
    toggleAllTools: (enabled: boolean) => void;
    updateToolConfig: (endpointId: string, config: Partial<ToolConfig>) => void;

    // Config actions
    setAuthConfig: (config: AuthConfig) => void;
    setMcpServerAuthConfig: (config: Partial<McpServerAuthConfig>) => void;
    setServerConfig: (config: Partial<ServerConfig>) => void;
    setExportConfig: (config: ExportConfigUpdate) => void;

    // Project history actions
    setProjectName: (name: string) => void;
    saveCurrentProject: (name?: string) => Promise<boolean>;
    loadProject: (id: string) => Promise<boolean>;
    renameProject: (id: string, name: string) => boolean;
    deleteProject: (id: string) => Promise<void>;
    undoDeleteProject: () => Promise<boolean>;
    exportProject: (id?: string) => Promise<string | null>;
    importProject: (input: string | PortableProjectFile) => Promise<boolean>;
    clearSavedProjects: () => Promise<void>;

    // State actions
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

function inferAuthConfig(securitySchemes: ParsedSpec["securitySchemes"]): AuthConfig {
    for (const scheme of Object.values(securitySchemes)) {
        const candidate = scheme as {
            type?: string;
            scheme?: string;
            in?: string;
            name?: string;
        };

        if (candidate.type === "apiKey") {
            return {
                type: "apiKey",
                apiKey: {
                    name: candidate.name || "X-API-Key",
                    in: candidate.in === "query" || candidate.in === "cookie" ? candidate.in : "header",
                },
            };
        }

        if (candidate.type === "http" && candidate.scheme === "bearer") {
            return { type: "bearer" };
        }

        if (candidate.type === "http" && candidate.scheme === "basic") {
            return { type: "basic" };
        }
    }

    return { type: "none" };
}

// Initial state
const initialState = {
    currentStep: "import" as const,
    spec: null,
    specSource: null,
    specFormat: null,
    activeProjectId: null,
    projectName: "Untitled project",
    autosaveStatus: "idle" as const,
    lastSavedAt: null,
    lastSpecDiff: null as SpecDiff | null,
    capabilityReport: null as CapabilityReport | null,
    endpointWarnings: null as PreparedImport["warnings"] | null,
    tools: [],
    authConfig: { type: "none" as const },
    mcpServerAuthConfig: { type: "none" as const, allowedOrigins: [] },
    serverConfig: {
        name: "my-mcp-server",
        version: "1.0.0",
        host: "localhost",
        port: 8080,
        transport: "http" as const,
    },
    exportConfig: {
        language: "node" as const,
        framework: "mcp-ts-sdk" as const,
        packageManager: "npm" as const,
        verificationMode: "fast" as const,
        compactMode: false,
        features: {
            documentation: true,
            docker: false,
            tests: true,
            // Process-spawning verification is intentionally CLI-only. Web
            // generation performs bounded structural validation instead.
            verification: false,
        },
    },
    savedProjects: [] as SavedProject[],
    deletedProject: null as DeletedProject | null,
    isLoading: false,
    error: null,
};

function normalizeExportConfig(
    exportConfig?: Partial<ExportConfig> | null
): ExportConfig {
    return {
        ...initialState.exportConfig,
        ...exportConfig,
        features: {
            ...initialState.exportConfig.features,
            ...(exportConfig?.features || {}),
        },
    };
}

function normalizeMcpServerAuthConfig(
    config?: Partial<McpServerAuthConfig> | null
): McpServerAuthConfig {
    return {
        type: config?.type === "bearer" ? "bearer" : "none",
        allowedOrigins: Array.isArray(config?.allowedOrigins)
            ? config.allowedOrigins.map((origin) => origin.trim()).filter(Boolean)
            : [],
    };
}

// Generate unique ID
function generateId(): string {
    return crypto.randomUUID();
}

function snapshotFromState(state: ProjectState): ProjectSnapshotData | null {
    if (!state.spec) return null;
    return {
        spec: state.spec,
        specSource: state.specSource || "unknown",
        specFormat: state.specFormat || state.spec.format || "openapi",
        tools: state.tools,
        authConfig: state.authConfig,
        mcpServerAuthConfig: state.mcpServerAuthConfig,
        serverConfig: state.serverConfig,
        exportConfig: state.exportConfig,
    };
}

async function writeProjectSnapshot(id: string, data: ProjectSnapshotData): Promise<void> {
    await writeStored(projectStorageKey(id), data);
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            ...initialState,

            setSpec: (spec, source, prepared) => {
                const recommended = new Set(spec.endpoints.filter((endpoint) => endpoint.method === "GET").slice(0, MAX_SELECTED_TOOLS).map((endpoint) => endpoint.id));
                set({
                    spec,
                    specSource: source,
                    specFormat: spec.format || "openapi",
                    activeProjectId: null,
                    projectName: spec.info.title || "Untitled project",
                    autosaveStatus: "idle",
                    lastSavedAt: null,
                    lastSpecDiff: null,
                    tools: prepared?.tools || spec.endpoints.map((endpoint) => ({ ...createToolConfig(endpoint), enabled: recommended.has(endpoint.id) })),
                    capabilityReport: prepared?.capabilities || null,
                    endpointWarnings: prepared?.warnings || null,
                    authConfig: inferAuthConfig(spec.securitySchemes),
                    serverConfig: {
                        ...initialState.serverConfig,
                        name: spec.info.title
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/(^-|-$)/g, "").slice(0, 64) || "my-mcp-server",
                    },
                    error: null,
                });
            },

            regenerateSpec: (nextSpec, source, prepared) => {
                const state = get();
                if (!state.spec) {
                    state.setSpec(nextSpec, source, prepared);
                    return null;
                }
                const diff = diffSpecs(state.spec, nextSpec);
                const oldEndpointById = new Map(state.spec.endpoints.map((endpoint) => [endpoint.id, endpoint]));
                const oldToolsByKey = new Map(state.tools.map((tool) => {
                    const endpoint = oldEndpointById.get(tool.endpointId);
                    return [endpoint ? `${endpoint.method} ${endpoint.path}` : tool.endpointId, tool] as const;
                }));
                const recommended = new Set((prepared?.tools || nextSpec.endpoints.filter((endpoint) => endpoint.method === "GET").slice(0, MAX_SELECTED_TOOLS).map((endpoint) => ({ endpointId: endpoint.id, enabled: true }))).filter((tool) => tool.enabled).map((tool) => tool.endpointId));
                const freshTools = new Map(prepared?.tools.map((tool) => [tool.endpointId, tool]));
                const mergedTools = nextSpec.endpoints.map((endpoint) => {
                    const fresh = freshTools.get(endpoint.id) || createToolConfig(endpoint);
                    const previous = oldToolsByKey.get(`${endpoint.method} ${endpoint.path}`);
                    if (!previous) return { ...fresh, enabled: recommended.has(endpoint.id) };
                    return sanitizeToolConfig({
                        ...fresh,
                        enabled: previous.enabled,
                        toolName: previous.toolName,
                        description: previous.description,
                        parameters: fresh.parameters.map((parameter) => {
                            const configured = previous.parameters.find((candidate) => candidate.location === parameter.location && candidate.originalName === parameter.originalName);
                            return configured ? { ...parameter, name: configured.name, description: configured.description, hidden: configured.hidden } : parameter;
                        }),
                    });
                });
                let selectedCount = 0;
                for (const tool of mergedTools) if (tool.enabled && ++selectedCount > MAX_SELECTED_TOOLS) tool.enabled = false;
                set({
                    spec: nextSpec,
                    specSource: source,
                    specFormat: nextSpec.format || "openapi",
                    tools: mergedTools,
                    capabilityReport: prepared?.capabilities || null,
                    endpointWarnings: prepared?.warnings || null,
                    authConfig: state.authConfig,
                    lastSpecDiff: diff,
                    error: null,
                });
                return diff;
            },

            clearSpec: () => set({
                spec: null,
                specSource: null,
                specFormat: null,
                activeProjectId: null,
                projectName: "Untitled project",
                autosaveStatus: "idle",
                lastSavedAt: null,
                lastSpecDiff: null,
                tools: [],
                currentStep: "import",
            }),

            setCurrentStep: (step) => set({ currentStep: step }),

            toggleTool: (endpointId) => set((state) => {
                const target = state.tools.find((tool) => tool.endpointId === endpointId);
                if (!target) return {};
                if (!target.enabled && state.tools.filter((tool) => tool.enabled).length >= MAX_SELECTED_TOOLS) return { error: "Select at most 500 tools per server. Deselect a tool before adding another." };
                return { tools: state.tools.map((tool) => tool.endpointId === endpointId ? { ...tool, enabled: !tool.enabled } : tool), error: null };
            }),
            setToolsEnabled: (ids, enabled, replace = false) => set((state) => {
                const selected = new Set(ids);
                let count = replace ? 0 : state.tools.filter((tool) => tool.enabled && !selected.has(tool.endpointId)).length;
                const tools = state.tools.map((tool) => {
                    const desired = selected.has(tool.endpointId) ? enabled : replace ? false : tool.enabled;
                    if (!selected.has(tool.endpointId) && !replace) return tool;
                    const next = desired && count < MAX_SELECTED_TOOLS;
                    if (next) count++;
                    return tool.enabled === next ? tool : { ...tool, enabled: next };
                });
                return { tools, error: enabled && ids.length > MAX_SELECTED_TOOLS ? "Only the first 500 tools were selected. Export additional endpoints in a separate server." : null };
            }),
            toggleAllTools: (enabled) => get().setToolsEnabled(get().tools.map((tool) => tool.endpointId), enabled, true),

            updateToolConfig: (endpointId, config) => set((state) => ({
                tools: state.tools.map((t) =>
                    t.endpointId === endpointId
                        ? sanitizeToolConfig({ ...t, ...config })
                        : t
                ),
            })),

            setAuthConfig: (config) => set({ authConfig: config }),

            setMcpServerAuthConfig: (config) => set((state) => ({
                mcpServerAuthConfig: normalizeMcpServerAuthConfig({
                    ...state.mcpServerAuthConfig,
                    ...config,
                }),
            })),

            setServerConfig: (config) => set((state) => ({
                serverConfig: { ...state.serverConfig, ...config },
            })),

            setExportConfig: (config) => set((state) => ({
                exportConfig: {
                    ...state.exportConfig,
                    ...config,
                    features: {
                        ...state.exportConfig.features,
                        ...config.features,
                    },
                },
            })),

            setProjectName: (name) => set({ projectName: name }),

            saveCurrentProject: async (name) => {
                const state = get();
                if (!state.spec) return false;
                const snapshot = snapshotFromState(state);
                if (!snapshot) return false;
                const existing = state.savedProjects.find((candidate) =>
                    candidate.id === state.activeProjectId
                );
                const savedAt = Date.now();
                const projectName = (name ?? state.projectName).trim() || state.spec.info.title || "Untitled project";

                const project: SavedProject = {
                    id: existing?.id || generateId(),
                    name: projectName,
                    source: snapshot.specSource,
                    format: snapshot.specFormat,
                    endpointCount: state.spec.endpoints.length,
                    savedAt,
                };

                // Store project data separately.
                // NOTE: the "makemcp-project-*" key prefix is kept deliberately so
                // existing users' saved projects survive the mcpmint rebrand.
                try {
                    await writeProjectSnapshot(project.id, snapshot);
                } catch (e) {
                    console.error("Failed to save project:", e);
                    set({ error: "This project could not be saved to browser history. Export a project file or download the server to keep a copy, and check browser storage settings." });
                    return false;
                }

                const update = upsertProjectHistory(state.savedProjects, project, 50);
                for (const evicted of update.evicted) {
                    try {
                        await removeStored(projectStorageKey(evicted.id));
                    } catch (e) {
                        console.warn("Failed to remove evicted project data:", e);
                    }
                }
                set({
                    savedProjects: update.projects,
                    activeProjectId: project.id,
                    projectName,
                    autosaveStatus: "saved",
                    lastSavedAt: savedAt,
                    error: null,
                });
                return true;
            },

            loadProject: async (id) => {
                try {
                    const data = await readStored<ProjectSnapshotData>(projectStorageKey(id));
                    if (!data) {
                        set({ error: "This saved project is no longer available. It may have been cleared by the browser." });
                        return false;
                    }

                    const metadata = get().savedProjects.find((candidate) => candidate.id === id);
                    if (!metadata) throw new Error("Saved project metadata is unavailable.");
                    const validated = await runProcessing<PortableProjectFile>({ action: "project-validate", project: { kind: "mcpmint-project", schemaVersion: 1, exportedAt: new Date().toISOString(), project: metadata, data } });
                    const { spec, specSource, specFormat, tools, authConfig, mcpServerAuthConfig, serverConfig, exportConfig } = validated.data;

                    // Projects saved before the canonical migration lack
                    // spec.apiModel, which generation now requires.
                    if (!spec?.apiModel) {
                        set({ error: "This saved project was created by an older version of mcpmint. Re-import the spec to continue." });
                        return false;
                    }

                    const project = get().savedProjects.find((candidate) => candidate.id === id);
                    set({
                        spec,
                        specSource: specSource || project?.source || spec?.info?.title || "Loaded Project",
                        specFormat: specFormat || project?.format || spec?.format || "openapi",
                        activeProjectId: id,
                        projectName: project?.name || spec?.info?.title || "Untitled project",
                        autosaveStatus: "saved",
                        lastSavedAt: project?.savedAt || null,
                        lastSpecDiff: null,
                        capabilityReport: null,
                        endpointWarnings: null,
                        tools: Array.isArray(tools) ? tools.map(sanitizeToolConfig) : [],
                        authConfig,
                        mcpServerAuthConfig: normalizeMcpServerAuthConfig(mcpServerAuthConfig),
                        serverConfig,
                        exportConfig: normalizeExportConfig(exportConfig),
                        currentStep: "editor",
                        error: null,
                    });
                    return true;
                } catch (e) {
                    console.error("Failed to load project:", e);
                    set({ error: "This saved project is damaged or unreadable. Re-import the original specification." });
                    return false;
                }
            },

            renameProject: (id, name) => {
                const normalized = name.trim();
                if (!normalized) {
                    set({ error: "Project name cannot be empty." });
                    return false;
                }
                const exists = get().savedProjects.some((project) => project.id === id);
                if (!exists) return false;
                set((state) => ({
                    savedProjects: state.savedProjects.map((project) => project.id === id ? { ...project, name: normalized } : project),
                    ...(state.activeProjectId === id ? { projectName: normalized } : {}),
                    error: null,
                }));
                return true;
            },

            deleteProject: async (id) => {
                try {
                    const project = get().savedProjects.find((candidate) => candidate.id === id);
                    const data = await readStored<ProjectSnapshotData>(projectStorageKey(id));
                    if (!project || !data) return;
                    await removeStored(projectStorageKey(id));
                    set((state) => ({
                        savedProjects: state.savedProjects.filter((candidate) => candidate.id !== id),
                        deletedProject: { project, data },
                        ...(state.activeProjectId === id ? {
                            activeProjectId: null,
                            autosaveStatus: "idle" as const,
                            lastSavedAt: null,
                        } : {}),
                    }));
                } catch (e) {
                    console.error("Failed to delete project:", e);
                    set({ error: "Project could not be deleted. Check browser storage settings." });
                }
            },

            undoDeleteProject: async () => {
                const deleted = get().deletedProject;
                if (!deleted) return false;
                try {
                    await writeStored(projectStorageKey(deleted.project.id), deleted.data);
                    set((state) => ({
                        savedProjects: [deleted.project, ...state.savedProjects.filter((project) => project.id !== deleted.project.id)],
                        deletedProject: null,
                        error: null,
                    }));
                    return true;
                } catch (e) {
                    console.error("Failed to restore project:", e);
                    set({ error: "Project could not be restored. Check browser storage settings." });
                    return false;
                }
            },

            exportProject: async (id) => {
                const state = get();
                try {
                    const data = id ? await readStored<ProjectSnapshotData>(projectStorageKey(id)) : snapshotFromState(state);
                    const project = id ? state.savedProjects.find((candidate) => candidate.id === id) : { id: state.activeProjectId || generateId(), name: state.projectName, source: state.specSource || "unknown", format: state.specFormat || "openapi", endpointCount: state.spec?.endpoints.length || 0, savedAt: Date.now() };
                    if (!data || !project) throw new Error("This project is no longer available.");
                    return await runProcessing<string>({ action: "project-export", project: { schemaVersion: 1, kind: "mcpmint-project", exportedAt: new Date().toISOString(), project, data } });
                } catch (error) { set({ error: error instanceof Error ? error.message : "Could not export project." }); return null; }
            },

            importProject: async (input) => {
                try {
                    const file = await runProcessing<PortableProjectFile>(typeof input === "string" ? { action: "project-import", content: input } : { action: "project-validate", project: input });
                    const state = get();
                    const id = generateId(); // Import a copy without replacing local work.
                    const savedAt = Date.now();
                    const project: SavedProject = { ...file.project, id, savedAt };
                    let saved = true;
                    try { await writeProjectSnapshot(id, file.data); } catch { saved = false; }
                    const update = upsertProjectHistory(state.savedProjects, project, 50);
                    if (saved) for (const evicted of update.evicted) {
                        try { await removeStored(projectStorageKey(evicted.id)); } catch { /* Keep the successful import when cleanup fails. */ }
                    }
                    set({
                        spec: file.data.spec,
                        specSource: file.data.specSource,
                        specFormat: file.data.specFormat,
                        tools: file.data.tools.map(sanitizeToolConfig),
                        authConfig: file.data.authConfig,
                        mcpServerAuthConfig: normalizeMcpServerAuthConfig(file.data.mcpServerAuthConfig),
                        serverConfig: file.data.serverConfig,
                        exportConfig: normalizeExportConfig(file.data.exportConfig),
                        currentStep: "editor",
                        savedProjects: saved ? update.projects : state.savedProjects,
                        activeProjectId: saved ? id : null,
                        projectName: project.name,
                        autosaveStatus: "saved",
                        lastSavedAt: savedAt,
                        lastSpecDiff: null,
                        capabilityReport: null,
                        endpointWarnings: null,
                        deletedProject: null,
                        error: saved ? null : "Project opened, but browser storage failed. Export a project file before leaving.",
                    });
                    return true;
                } catch (e) {
                    set({ error: e instanceof Error ? e.message : "Project file could not be imported." });
                    return false;
                }
            },

            clearSavedProjects: async () => {
                try { for (const project of get().savedProjects) await removeStored(projectStorageKey(project.id)); }
                catch { set({ error: "Project history could not be fully cleared. Check browser storage settings." }); return; }
                set({ savedProjects: [], deletedProject: null, activeProjectId: null, autosaveStatus: "idle", lastSavedAt: null, error: null });
            },

            setLoading: (isLoading) => set({ isLoading }),

            setError: (error) => set({ error }),

            reset: () => set({
                ...initialState,
                savedProjects: get().savedProjects, // Keep saved projects
            }),
        }),
        {
            // Legacy persist key kept intentionally so existing users' sessions survive the mcpmint rebrand.
            name: "makemcp-storage",
            storage: createProjectStorage(async (stored) => {
                const persisted = stored as PersistedProjectState;
                if (!persisted.spec) return stored;
                try {
                    const snapshot = await runProcessing<ProjectSnapshotData>({ action: "snapshot-validate", snapshot: {
                        spec: persisted.spec, tools: persisted.tools,
                        authConfig: persisted.authConfig, mcpServerAuthConfig: persisted.mcpServerAuthConfig,
                        serverConfig: persisted.serverConfig, exportConfig: persisted.exportConfig,
                        specSource: persisted.specSource || "unknown", specFormat: persisted.specFormat || "openapi",
                    } });
                    return { ...persisted, ...snapshot, capabilityReport: null, endpointWarnings: null };
                } catch {
                    return { ...persisted, spec: null, tools: [], currentStep: "import", activeProjectId: null,
                        capabilityReport: null, endpointWarnings: null,
                        error: "Your previous session is damaged or from an unsupported version. Import the original spec or a valid project file to recover." };
                }
            }),
            // v2: the generator requires spec.apiModel (the canonical path is the
            // only path). Sessions persisted before the canonical migration have a
            // spec without apiModel and would throw deep inside generation, so
            // migrate drops the stale working session and keeps only config/history.
            version: 4,
            migrate: (persistedState, version) => {
                const persisted = (persistedState as PersistedProjectState | undefined) || {};

                if (version < 2 && persisted.spec && !persisted.spec.apiModel) {
                    return {
                        ...persisted,
                        spec: null,
                        specSource: null,
                        specFormat: null,
                        tools: [],
                        currentStep: "import" as const,
                    };
                }

                return persisted;
            },
            merge: (persistedState, currentState) => {
                const persisted = (persistedState as PersistedProjectState | undefined) || {};

                const spec = persisted.spec ?? currentState.spec;

                return {
                    ...currentState,
                    ...persisted,
                    // Restore the in-progress working session if one was persisted.
                    spec,
                    tools: Array.isArray(persisted.tools)
                        ? persisted.tools.map(sanitizeToolConfig)
                        : currentState.tools,
                    authConfig: persisted.authConfig ?? currentState.authConfig,
                    serverConfig: persisted.serverConfig ?? currentState.serverConfig,
                    // Only trust a persisted step when there is actually a spec to resume.
                    currentStep: spec ? (persisted.currentStep ?? currentState.currentStep) : "import",
                    exportConfig: normalizeExportConfig(persisted.exportConfig),
                    mcpServerAuthConfig: normalizeMcpServerAuthConfig(persisted.mcpServerAuthConfig),
                    savedProjects: Array.isArray(persisted.savedProjects)
                        ? persisted.savedProjects.filter((project) => project && typeof project.id === "string" && typeof project.name === "string" && typeof project.source === "string" && Number.isFinite(project.savedAt) && Number.isFinite(project.endpointCount))
                        : currentState.savedProjects,
                };
            },
            partialize: (state) => ({
                // Persisted config + history
                savedProjects: state.savedProjects,
                exportConfig: state.exportConfig,
                // In-progress working session so a refresh mid-edit restores the user's work.
                capabilityReport: state.capabilityReport,
                endpointWarnings: state.endpointWarnings,
                spec: state.spec,
                specSource: state.specSource,
                specFormat: state.specFormat,
                activeProjectId: state.activeProjectId,
                projectName: state.projectName,
                lastSavedAt: state.lastSavedAt,
                tools: state.tools,
                authConfig: state.authConfig,
                mcpServerAuthConfig: state.mcpServerAuthConfig,
                serverConfig: state.serverConfig,
                currentStep: state.currentStep,
            }),
        }
    )
);

if (typeof window !== "undefined") {
    useProjectStore.subscribe((state, previous) => {
        const changed = state.spec !== previous.spec
            || state.specSource !== previous.specSource
            || state.specFormat !== previous.specFormat
            || state.projectName !== previous.projectName
            || state.tools !== previous.tools
            || state.authConfig !== previous.authConfig
            || state.mcpServerAuthConfig !== previous.mcpServerAuthConfig
            || state.serverConfig !== previous.serverConfig
            || state.exportConfig !== previous.exportConfig;
        if (!changed || !state.activeProjectId || !state.spec) return;
        const id = state.activeProjectId;
        const snapshot = snapshotFromState(state)!;
        useProjectStore.setState({ autosaveStatus: "saving" });
        void writeProjectSnapshot(id, snapshot).then(() => {
            const latest = useProjectStore.getState();
            const stillCurrent = latest.activeProjectId === id && latest.spec === state.spec
                && latest.tools === state.tools && latest.serverConfig === state.serverConfig
                && latest.exportConfig === state.exportConfig && latest.authConfig === state.authConfig
                && latest.mcpServerAuthConfig === state.mcpServerAuthConfig && latest.projectName === state.projectName;
            const savedAt = Date.now();
            useProjectStore.setState({
                savedProjects: latest.savedProjects.map((project) => project.id === id
                    ? { ...project, name: state.projectName.trim() || project.name, source: snapshot.specSource, format: snapshot.specFormat, endpointCount: snapshot.spec.endpoints.length, savedAt }
                    : project),
                ...(stillCurrent ? { autosaveStatus: "saved", lastSavedAt: savedAt } : {}),
            });
        }).catch(() => {
            if (useProjectStore.getState().activeProjectId === id) useProjectStore.setState({ autosaveStatus: "error", error: "Autosave failed. Export a project file before leaving this page." });
        });
    });
}
