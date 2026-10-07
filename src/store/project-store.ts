import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getBodyContentKind, isBinarySchema, isShallowSimpleObjectSchema } from "@/lib/generator/utils";
import { projectStorageKey, upsertProjectHistory } from "./project-history";
import {
    parseProjectFile,
    validateProjectSnapshot,
    serializeProjectFile,
    type PortableProjectFile,
    type ProjectSnapshotData,
} from "./project-file";
import { analyzeCapabilities } from "@/lib/capabilities";
import { diffSpecs, type SpecDiff } from "@/lib/spec-diff";

// Parsed API spec types now live in the lib layer (api-model). Re-exported here
// so existing store consumers keep importing them from the store unchanged.
export type { ParsedParameter, ParsedEndpoint, ParsedSpec } from "@/lib/api-model/parsed-spec";
import type { ParsedEndpoint, ParsedSpec } from "@/lib/api-model/parsed-spec";

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
    data: string;
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
    setSpec: (spec: ParsedSpec, source: string) => void;
    regenerateSpec: (spec: ParsedSpec, source: string) => SpecDiff | null;
    clearSpec: () => void;
    setCurrentStep: (step: "import" | "editor" | "export") => void;

    // Tool actions
    toggleTool: (endpointId: string) => void;
    toggleAllTools: (enabled: boolean) => void;
    updateToolConfig: (endpointId: string, config: Partial<ToolConfig>) => void;

    // Config actions
    setAuthConfig: (config: AuthConfig) => void;
    setMcpServerAuthConfig: (config: Partial<McpServerAuthConfig>) => void;
    setServerConfig: (config: Partial<ServerConfig>) => void;
    setExportConfig: (config: ExportConfigUpdate) => void;

    // Project history actions
    setProjectName: (name: string) => void;
    saveCurrentProject: (name?: string) => boolean;
    loadProject: (id: string) => boolean;
    renameProject: (id: string, name: string) => boolean;
    deleteProject: (id: string) => void;
    undoDeleteProject: () => boolean;
    exportProject: (id?: string) => string | null;
    importProject: (text: string) => boolean;
    clearSavedProjects: () => void;

    // State actions
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

function sanitizeIdentifier(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const safeValue = normalized || fallback;
    return /^[a-zA-Z_]/.test(safeValue) ? safeValue : `${fallback}_${safeValue}`;
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

function sanitizeToolConfig(tool: ToolConfig): ToolConfig {
    return {
        ...tool,
        toolName: sanitizeIdentifier(tool.toolName, "tool"),
        parameters: tool.parameters.map((parameter, index) => ({
            ...parameter,
            name: sanitizeIdentifier(parameter.name, `param_${index + 1}`),
            hidden: parameter.hidden || false,
        })),
    };
}

// Generate a human-readable type string from schema
function getTypeFromSchema(schema: Record<string, unknown>): string {
    if (!schema) return "any";

    const type = schema.type as string;

    if (type === "array") {
        const items = schema.items as Record<string, unknown>;
        if (items) {
            return `${getTypeFromSchema(items)}[]`;
        }
        return "any[]";
    }

    if (type === "object" || schema.properties) {
        // Return a summary of the object structure
        const props = schema.properties as Record<string, Record<string, unknown>>;
        if (props) {
            const keys = Object.keys(props).slice(0, 3);
            const suffix = Object.keys(props).length > 3 ? ", ..." : "";
            return `{${keys.join(", ")}${suffix}}`;
        }
        return "object";
    }

    return type || "string";
}

// Generate example value from schema (recursively resolves nested objects)
function generateExampleFromSchema(schema: Record<string, unknown>): unknown {
    if (!schema) return null;

    const type = schema.type as string;
    const example = schema.example;
    const defaultVal = schema.default;

    // Use example or default if provided
    if (example !== undefined) return example;
    if (defaultVal !== undefined) return defaultVal;

    // Handle enums
    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[0];
    }

    // Generate based on type
    switch (type) {
        case "string":
            if (schema.format === "date") return "2024-01-15";
            if (schema.format === "date-time") return "2024-01-15T10:30:00Z";
            if (schema.format === "email") return "user@example.com";
            if (schema.format === "uri" || schema.format === "url") return "https://example.com";
            if (schema.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
            return "string";

        case "integer":
        case "number":
            if (schema.minimum !== undefined) return schema.minimum;
            return 0;

        case "boolean":
            return true;

        case "array":
            const items = schema.items as Record<string, unknown>;
            if (items) {
                return [generateExampleFromSchema(items)];
            }
            return [];

        case "object":
        default:
            const properties = schema.properties as Record<string, Record<string, unknown>>;
            if (properties) {
                const obj: Record<string, unknown> = {};
                for (const [key, propSchema] of Object.entries(properties)) {
                    obj[key] = generateExampleFromSchema(propSchema);
                }
                return obj;
            }
            // If no type but has properties, treat as object
            if (!type && schema.properties) {
                const props = schema.properties as Record<string, Record<string, unknown>>;
                const obj: Record<string, unknown> = {};
                for (const [key, propSchema] of Object.entries(props)) {
                    obj[key] = generateExampleFromSchema(propSchema);
                }
                return obj;
            }
            return {};
    }
}

// Generate tool name from endpoint
function generateToolName(endpoint: ParsedEndpoint): string {
    if (endpoint.operationId) {
        return sanitizeIdentifier(endpoint.operationId, "tool");
    }

    // Generate from method + path
    const pathParts = endpoint.path
        .split("/")
        .filter(Boolean)
        .map((part) => {
            if (part.startsWith("{") && part.endsWith("}")) {
                return "By" + part.slice(1, -1).charAt(0).toUpperCase() + part.slice(2, -1);
            }
            return part.charAt(0).toUpperCase() + part.slice(1);
        });

    const methodPrefix = endpoint.method.toLowerCase();
    return sanitizeIdentifier(methodPrefix + pathParts.join(""), "tool");
}

// Create tool config from endpoint
function createToolConfig(endpoint: ParsedEndpoint): ToolConfig {
    // URL parameters (path, query, header)
    const urlParams = endpoint.parameters.map((p, index) => ({
        name: sanitizeIdentifier(p.name, `param_${index + 1}`),
        originalName: p.name,
        type: p.type,
        required: p.required,
        description: p.description || "",
        location: p.in as "path" | "query" | "header" | "cookie" | "body",
    }));

    // Request body parameters (for POST/PUT/PATCH)
    const bodyParams: ToolConfig["parameters"] = [];
    let bodySchema: Record<string, unknown> | undefined;
    let bodyContentType: string | undefined;
    let bodyExample: string | undefined;
    let description = endpoint.summary || endpoint.description || `${endpoint.method} ${endpoint.path}`;

    if (endpoint.requestBody?.schema) {
        const schema = endpoint.requestBody.schema as {
            type?: string;
            properties?: Record<string, Record<string, unknown>>;
            required?: string[];
            items?: Record<string, unknown>;
        };

        // Store the full schema
        bodySchema = endpoint.requestBody.schema;
        bodyContentType = endpoint.requestBody.contentType;

        // Generate example JSON
        const example = generateExampleFromSchema(endpoint.requestBody.schema);
        bodyExample = JSON.stringify(example, null, 2);

        const requiredFields = schema.required || [];

        const bodyKind = getBodyContentKind(
            {
                endpointId: endpoint.id,
                enabled: true,
                toolName: endpoint.operationId || endpoint.summary || endpoint.id,
                description,
                parameters: [],
                bodySchema,
                bodyContentType,
            },
            []
        );
        const exposeProperties =
            (bodyKind === "flattenedObject" && isShallowSimpleObjectSchema(schema)) ||
            (["formUrlencoded", "multipart"].includes(bodyKind || "") && Boolean(schema.properties));

        if (schema.properties && exposeProperties) {
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                bodyParams.push({
                    name: sanitizeIdentifier(propName, `body_${bodyParams.length + 1}`),
                    originalName: propName,
                    type: getTypeFromSchema(propSchema),
                    required: requiredFields.includes(propName),
                    description: [
                        (propSchema.description as string) || "",
                        bodyKind === "multipart" && isBinarySchema(propSchema) ? "Base64-encoded file content." : "",
                    ].filter(Boolean).join(" "),
                    location: "body",
                    schema: propSchema,
                });
            }
        } else if (bodyKind) {
            bodyParams.push({
                name: "body",
                originalName: "body",
                type: getTypeFromSchema(schema),
                required: endpoint.requestBody.required,
                description: schema.type === "array" ? "Request body array" : "Request body",
                location: "body",
                schema: schema,
            });
        }
    }

    // Build enhanced description with example if available
    if (bodyExample && bodyParams.length > 0) {
        description = `${description}\n\nRequest body example:\n${bodyExample}`;
    }

    return {
        endpointId: endpoint.id,
        enabled: false,
        toolName: generateToolName(endpoint),
        description,
        parameters: [...urlParams, ...bodyParams],
        bodySchema,
        bodyContentType,
        bodyExample,
    };
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

function writeProjectSnapshot(id: string, data: ProjectSnapshotData): void {
    localStorage.setItem(projectStorageKey(id), JSON.stringify(data));
}

// localStorage-backed storage that fails gracefully when a very large spec
// exceeds the quota, so persistence never throws and breaks the app.
const safeLocalStorage = {
    getItem: (name: string): string | null => {
        try {
            return localStorage.getItem(name);
        } catch {
            return null;
        }
    },
    setItem: (name: string, value: string): void => {
        try {
            localStorage.setItem(name, value);
        } catch (e) {
            // Quota exceeded (e.g. an oversized spec) or storage unavailable.
            // Keep the in-memory session working; just skip persistence.
            console.warn("mcpmint: unable to persist session (storage full or unavailable)", e);
        }
    },
    removeItem: (name: string): void => {
        try {
            localStorage.removeItem(name);
        } catch {
            /* no-op */
        }
    },
};

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            ...initialState,

            setSpec: (spec, source) => {
                const recommended = new Set(spec.apiModel
                    ? analyzeCapabilities(spec.apiModel).operations.filter((item) => item.recommended).map((item) => item.operationId)
                    : spec.endpoints.filter((endpoint) => endpoint.method === "GET").map((endpoint) => endpoint.id));
                set({
                    spec,
                    specSource: source,
                    specFormat: spec.format || "openapi",
                    activeProjectId: null,
                    projectName: spec.info.title || "Untitled project",
                    autosaveStatus: "idle",
                    lastSavedAt: null,
                    lastSpecDiff: null,
                    tools: spec.endpoints.map((endpoint) => ({ ...createToolConfig(endpoint), enabled: recommended.has(endpoint.id) })),
                    authConfig: inferAuthConfig(spec.securitySchemes),
                    serverConfig: {
                        ...initialState.serverConfig,
                        name: spec.info.title
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/(^-|-$)/g, "") || "my-mcp-server",
                    },
                    error: null,
                });
            },

            regenerateSpec: (nextSpec, source) => {
                const state = get();
                if (!state.spec) {
                    state.setSpec(nextSpec, source);
                    return null;
                }
                const diff = diffSpecs(state.spec, nextSpec);
                const oldEndpointById = new Map(state.spec.endpoints.map((endpoint) => [endpoint.id, endpoint]));
                const oldToolsByKey = new Map(state.tools.map((tool) => {
                    const endpoint = oldEndpointById.get(tool.endpointId);
                    return [endpoint ? `${endpoint.method} ${endpoint.path}` : tool.endpointId, tool] as const;
                }));
                const recommended = new Set(nextSpec.apiModel
                    ? analyzeCapabilities(nextSpec.apiModel).operations.filter((item) => item.recommended).map((item) => item.operationId)
                    : nextSpec.endpoints.filter((endpoint) => endpoint.method === "GET").map((endpoint) => endpoint.id));
                const mergedTools = nextSpec.endpoints.map((endpoint) => {
                    const fresh = createToolConfig(endpoint);
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
                set({
                    spec: nextSpec,
                    specSource: source,
                    specFormat: nextSpec.format || "openapi",
                    tools: mergedTools,
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

            toggleTool: (endpointId) => set((state) => ({
                tools: state.tools.map((t) =>
                    t.endpointId === endpointId ? { ...t, enabled: !t.enabled } : t
                ),
            })),

            toggleAllTools: (enabled) => set((state) => ({
                tools: state.tools.map((t) => ({ ...t, enabled })),
            })),

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

            saveCurrentProject: (name) => {
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
                    writeProjectSnapshot(project.id, snapshot);
                } catch (e) {
                    console.error("Failed to save project:", e);
                    set({ error: "This project could not be saved to browser history. Export a project file or download the server to keep a copy, and check browser storage settings." });
                    return false;
                }

                const update = upsertProjectHistory(state.savedProjects, project, 50);
                for (const evicted of update.evicted) {
                    try {
                        localStorage.removeItem(projectStorageKey(evicted.id));
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

            loadProject: (id) => {
                try {
                    const data = localStorage.getItem(projectStorageKey(id));
                    if (!data) {
                        set({ error: "This saved project is no longer available. It may have been cleared by the browser." });
                        return false;
                    }

                    const { spec, specSource, specFormat, tools, authConfig, mcpServerAuthConfig, serverConfig, exportConfig } = validateProjectSnapshot(JSON.parse(data));

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

            deleteProject: (id) => {
                try {
                    const project = get().savedProjects.find((candidate) => candidate.id === id);
                    const data = localStorage.getItem(projectStorageKey(id));
                    if (!project || !data) return;
                    localStorage.removeItem(projectStorageKey(id));
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

            undoDeleteProject: () => {
                const deleted = get().deletedProject;
                if (!deleted) return false;
                try {
                    localStorage.setItem(projectStorageKey(deleted.project.id), deleted.data);
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

            exportProject: (id) => {
                const state = get();
                const targetId = id || state.activeProjectId;
                if (!targetId) {
                    set({ error: "Save this project before exporting a project file." });
                    return null;
                }
                const project = state.savedProjects.find((candidate) => candidate.id === targetId);
                const raw = localStorage.getItem(projectStorageKey(targetId));
                if (!project || !raw) {
                    set({ error: "This project is no longer available in browser storage." });
                    return null;
                }
                try {
                    const data = JSON.parse(raw) as ProjectSnapshotData;
                    const file: PortableProjectFile = {
                        schemaVersion: 1,
                        kind: "mcpmint-project",
                        exportedAt: new Date().toISOString(),
                        project,
                        data,
                    };
                    return serializeProjectFile(file);
                } catch {
                    set({ error: "This saved project is damaged and cannot be exported." });
                    return null;
                }
            },

            importProject: (text) => {
                try {
                    const file = parseProjectFile(text);
                    const state = get();
                    const id = generateId(); // Import a copy; never overwrite a local project.
                    const savedAt = Date.now();
                    const project: SavedProject = { ...file.project, id, savedAt };
                    writeProjectSnapshot(id, file.data);
                    const update = upsertProjectHistory(state.savedProjects, project, 50);
                    for (const evicted of update.evicted) {
                        try { localStorage.removeItem(projectStorageKey(evicted.id)); } catch { /* Preserve the successful import if cleanup is unavailable. */ }
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
                        savedProjects: update.projects,
                        activeProjectId: id,
                        projectName: project.name,
                        autosaveStatus: "saved",
                        lastSavedAt: savedAt,
                        lastSpecDiff: null,
                        deletedProject: null,
                        error: null,
                    });
                    return true;
                } catch (e) {
                    set({ error: e instanceof Error ? e.message : "Project file could not be imported." });
                    return false;
                }
            },

            clearSavedProjects: () => {
                try {
                    const keys: string[] = [];
                    for (let index = 0; index < localStorage.length; index += 1) {
                        const key = localStorage.key(index);
                        if (key?.startsWith("makemcp-project-")) keys.push(key);
                    }
                    for (const key of keys) localStorage.removeItem(key);
                } catch (e) {
                    console.error("Failed to clear project history:", e);
                    set({ error: "Project history could not be fully cleared. Check your browser storage settings." });
                    return;
                }

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
            storage: createJSONStorage(() => safeLocalStorage),
            // v2: the generator requires spec.apiModel (the canonical path is the
            // only path). Sessions persisted before the canonical migration have a
            // spec without apiModel and would throw deep inside generation, so
            // migrate drops the stale working session and keeps only config/history.
            version: 3,
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

                let snapshot: ProjectSnapshotData | null = null;
                let recoveryError: string | null = null;
                try {
                    if (persisted.spec) snapshot = validateProjectSnapshot({
                        ...persisted,
                        specSource: persisted.specSource || "unknown",
                        specFormat: persisted.specFormat || "openapi",
                    });
                } catch {
                    recoveryError = "Your previous session is damaged or from an unsupported version. Import the original spec or a valid project file to recover.";
                }
                const history = Array.isArray(persisted.savedProjects) ? persisted.savedProjects.filter((p) =>
                    p && typeof p.id === "string" && typeof p.name === "string" && typeof p.source === "string"
                    && typeof p.savedAt === "number" && typeof p.endpointCount === "number") : [];
                return {
                    ...currentState,
                    ...(snapshot || {}),
                    spec: snapshot?.spec || null,
                    tools: snapshot?.tools.map(sanitizeToolConfig) || [],
                    currentStep: snapshot && ["import", "editor", "export"].includes(persisted.currentStep || "") ? persisted.currentStep! : "import",
                    savedProjects: history,
                    activeProjectId: snapshot && typeof persisted.activeProjectId === "string" ? persisted.activeProjectId : null,
                    projectName: snapshot && typeof persisted.projectName === "string" ? persisted.projectName : "Untitled project",
                    lastSavedAt: typeof persisted.lastSavedAt === "number" ? persisted.lastSavedAt : null,
                    error: recoveryError,
                };
            },
            partialize: (state) => ({
                // Persisted config + history
                savedProjects: state.savedProjects,
                exportConfig: state.exportConfig,
                // In-progress working session so a refresh mid-edit restores the user's work.
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

let projectAutosaveTimer: ReturnType<typeof setTimeout> | undefined;

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

        useProjectStore.setState({ autosaveStatus: "saving" });
        if (projectAutosaveTimer) clearTimeout(projectAutosaveTimer);
        projectAutosaveTimer = setTimeout(() => {
            const current = useProjectStore.getState();
            const snapshot = snapshotFromState(current);
            if (!snapshot || !current.activeProjectId) return;
            try {
                writeProjectSnapshot(current.activeProjectId, snapshot);
                const savedAt = Date.now();
                useProjectStore.setState({
                    savedProjects: current.savedProjects.map((project) => project.id === current.activeProjectId
                        ? {
                            ...project,
                            name: current.projectName.trim() || project.name,
                            source: snapshot.specSource,
                            format: snapshot.specFormat,
                            endpointCount: snapshot.spec.endpoints.length,
                            savedAt,
                        }
                        : project),
                    autosaveStatus: "saved",
                    lastSavedAt: savedAt,
                    error: null,
                });
            } catch (error) {
                console.error("Failed to autosave project:", error);
                useProjectStore.setState({
                    autosaveStatus: "error",
                    error: "Autosave failed. Export a project file before leaving this page.",
                });
            }
        }, 600);
    });
}
