export interface McpClientConfigInput {
    serverName: string;
    transport: "stdio" | "http" | "sse";
    transportUrl?: string;
    stdioCommand?: string;
    stdioArgs?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
}

export type ClientOperatingSystem = "macos" | "windows" | "linux";
export type McpClient = "claude-desktop" | "cursor" | "claude-code" | "vscode";

export function detectOperatingSystem(platform = "", userAgent = ""): ClientOperatingSystem {
    const value = `${platform} ${userAgent}`.toLowerCase();
    if (value.includes("win")) return "windows";
    if (value.includes("mac")) return "macos";
    return "linux";
}

export function clientConfigLocation(client: McpClient, os: ClientOperatingSystem): string {
    if (client === "claude-code") return "Managed by the claude mcp CLI";
    if (client === "vscode") return os === "windows" ? "%USERPROFILE%\\.vscode\\mcp.json" : "~/.vscode/mcp.json";
    if (client === "cursor") return os === "windows" ? "%USERPROFILE%\\.cursor\\mcp.json" : "~/.cursor/mcp.json";
    if (os === "windows") return "%APPDATA%\\Claude\\claude_desktop_config.json";
    if (os === "macos") return "~/Library/Application Support/Claude/claude_desktop_config.json";
    return "~/.config/Claude/claude_desktop_config.json";
}

export function isAbsoluteProjectPath(path: string, os: ClientOperatingSystem): boolean {
    if (!path || path.includes("/absolute/path/to/") || path.includes("\\absolute\\path\\to\\")) return false;
    return os === "windows"
        ? /^(?:[a-zA-Z]:\\|\\\\)[^\0]+/.test(path)
        : /^\/(?!\/)[^\0]+/.test(path);
}

export const ABSOLUTE_PROJECT_PATH_PLACEHOLDER = "/absolute/path/to/generated-project";

export function joinProjectPath(projectDirectory: string, relativePath: string): string {
    const separator = projectDirectory.includes("\\") ? "\\" : "/";
    const root = projectDirectory.replace(/[\\/]+$/, "");
    const child = relativePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
    return `${root}${separator}${child}`;
}

export function renderMcpClientConfig(input: McpClientConfigInput): string {
    const server = input.transport === "stdio"
        ? {
            command: input.stdioCommand,
            args: input.stdioArgs || [],
            env: input.env || {},
        }
        : { url: input.transportUrl, ...(input.headers ? { headers: input.headers } : {}) };

    return JSON.stringify({
        mcpServers: {
            [input.serverName]: server,
        },
    }, null, 2);
}

export function renderVsCodeClientConfig(input: McpClientConfigInput): string {
    const server = input.transport === "stdio"
        ? {
            type: "stdio",
            command: input.stdioCommand,
            args: input.stdioArgs || [],
            env: input.env || {},
        }
        : {
            type: input.transport === "sse" ? "sse" : "http",
            url: input.transportUrl,
            ...(input.headers ? { headers: input.headers } : {}),
        };
    return JSON.stringify({ servers: { [input.serverName]: server } }, null, 2);
}

function quoteShellArgument(value: string): string {
    if (/^[a-zA-Z0-9_./:\\-]+$/.test(value)) return value;
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function renderClaudeCodeCommand(input: McpClientConfigInput): string {
    const name = quoteShellArgument(input.serverName);
    if (input.transport === "stdio") {
        const command = [input.stdioCommand || "", ...(input.stdioArgs || [])]
            .filter(Boolean)
            .map(quoteShellArgument)
            .join(" ");
        const envFlags = Object.entries(input.env || {}).map(([key, value]) => ` --env ${quoteShellArgument(`${key}=${value}`)}`).join("");
        return `claude mcp add${envFlags} ${name} -- ${command}`;
    }

    const transport = input.transport === "sse" ? "sse" : "http";
    const headers = Object.entries(input.headers || {}).map(([key, value]) => ` --header ${quoteShellArgument(`${key}: ${value}`)}`).join("");
    return `claude mcp add --transport ${transport}${headers} ${name} ${quoteShellArgument(input.transportUrl || "")}`;
}


export function renderConnectionCheck(input: McpClientConfigInput, client: McpClient): string {
    if (client === "claude-code") return `claude mcp get ${quoteShellArgument(input.serverName)} && claude mcp list`;
    if (input.transport !== "stdio") {
        if (input.transport === "sse") return "npx --yes @modelcontextprotocol/inspector";
        const headers = Object.entries(input.headers || {}).map(([key, value]) => ` -H ${quoteShellArgument(`${key}: ${value}`)}`).join("");
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mcpmint-check", version: "1" } } });
        return `curl --fail --show-error --include -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream'${headers} --data ${quoteShellArgument(body)} ${quoteShellArgument(input.transportUrl || "")}`;
    }
    const command = [input.stdioCommand || "", ...(input.stdioArgs || [])]
        .filter(Boolean)
        .map(quoteShellArgument)
        .join(" ");
    return `npx --yes @modelcontextprotocol/inspector ${command}`;
}
