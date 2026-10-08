"use client";

import { trackEvent } from "@/lib/analytics/client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Monitor, Terminal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clientConfigLocation,
  detectOperatingSystem,
  isAbsoluteProjectPath,
  joinProjectPath,
  renderClaudeCodeCommand,
  renderConnectionCheck,
  renderMcpClientConfig,
  renderVsCodeClientConfig,
  type ClientOperatingSystem,
  type McpClient,
  type McpClientConfigInput,
} from "@/lib/generator/client-config";

import { mcpEndpointUrl } from "@/lib/generator/installation";

export interface InstallationSnapshot {
  serverName: string;
  language: "node" | "python";
  packageManager: "npm" | "pnpm" | "yarn";
  transport: "stdio" | "http" | "sse";
  host: string;
  port: number;
  authType: "apiKey" | "bearer" | "basic" | "none";
  baseUrl: string;
  authEnv: Record<string, string>;
  mcpAuthType: "none" | "bearer";
}

const osLabels: Record<ClientOperatingSystem, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };
const clientLabels: Record<McpClient, string> = {
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  "claude-code": "Claude Code",
  vscode: "VS Code",
};

function transportUrl(snapshot: InstallationSnapshot): string {
  return mcpEndpointUrl(snapshot.language, snapshot.transport, snapshot.host, snapshot.port);
}

function inputFor(snapshot: InstallationSnapshot, projectDirectory: string, os: ClientOperatingSystem, endpoint: string): McpClientConfigInput {
  if (snapshot.transport !== "stdio") {
    return { serverName: snapshot.serverName, transport: snapshot.transport, transportUrl: endpoint,
      ...(snapshot.mcpAuthType === "bearer" ? { headers: { Authorization: "Bearer replace_with_MCP_AUTH_TOKEN" } } : {}),
    };
  }
  const entrypoint = snapshot.language === "python"
    ? joinProjectPath(projectDirectory, "src/server.py")
    : joinProjectPath(projectDirectory, "dist/src/index.js");
  const env = snapshot.authEnv;
  return {
    serverName: snapshot.serverName,
    transport: "stdio",
    stdioCommand: snapshot.language === "python" ? joinProjectPath(projectDirectory, os === "windows" ? ".venv/Scripts/python.exe" : ".venv/bin/python") : "node",
    stdioArgs: [entrypoint],
    env,
  };
}

function configFor(client: McpClient, input: McpClientConfigInput): { language: "json" | "bash"; value: string } {
  if (client === "claude-code") return { language: "bash", value: renderClaudeCodeCommand(input) };
  if (client === "vscode") return { language: "json", value: renderVsCodeClientConfig(input) };
  return { language: "json", value: renderMcpClientConfig(input) };
}

export function InstallationWizard({ snapshot }: { snapshot: InstallationSnapshot }) {
  const [os, setOs] = useState<ClientOperatingSystem>("macos");
  const [client, setClient] = useState<McpClient>(snapshot.transport === "stdio" ? "claude-desktop" : "claude-code");
  const [projectDirectory, setProjectDirectory] = useState(`/absolute/path/to/${snapshot.serverName}`);
  const [verified, setVerified] = useState(false);
  const [endpoint, setEndpoint] = useState(transportUrl(snapshot));

  useEffect(() => {
    const timer = setTimeout(() => setOs(detectOperatingSystem(navigator.platform, navigator.userAgent)), 0);
    return () => clearTimeout(timer);
  }, []);

  const clientInput = useMemo(() => inputFor(snapshot, projectDirectory, os, endpoint), [snapshot, projectDirectory, os, endpoint]);
  const config = configFor(client, clientInput);
  const location = clientConfigLocation(client, os);
  const checkCommand = renderConnectionCheck(clientInput, client);
  const pathValid = snapshot.transport !== "stdio" || isAbsoluteProjectPath(projectDirectory, os);
  const python = os === "windows" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";
  const installCommand = snapshot.language === "python"
    ? `${os === "windows" ? "py" : "python3"} -m venv .venv, then ${python} -m pip install -e .`
    : `${snapshot.packageManager} install, then ${snapshot.packageManager === "npm" ? "npm run" : snapshot.packageManager} build`;
  const runCommand = snapshot.language === "python" ? `${python} src/server.py`
    : snapshot.packageManager === "npm" ? "npm start" : `${snapshot.packageManager} start`;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="installation-os" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Operating system</Label>
          <select id="installation-os" value={os} onChange={(event) => { setOs(event.target.value as ClientOperatingSystem); setVerified(false); }} className="h-10 w-full border border-border bg-background px-3 text-xs outline-none focus:border-primary">
            {Object.entries(osLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="installation-client" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MCP client</Label>
          <select id="installation-client" value={client} onChange={(event) => { setClient(event.target.value as McpClient); setVerified(false); }} className="h-10 w-full border border-border bg-background px-3 text-xs outline-none focus:border-primary">
            {Object.entries(clientLabels).filter(([value]) => snapshot.transport === "stdio" || value !== "claude-desktop").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {snapshot.transport === "stdio" && (
        <div className="space-y-2">
          <Label htmlFor="installation-project-directory" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Extracted project folder on {osLabels[os]}</Label>
          <Input id="installation-project-directory" value={projectDirectory} onChange={(event) => { setProjectDirectory(event.target.value); setVerified(false); }} className="h-10 rounded-none bg-background text-xs" aria-invalid={!pathValid} />
          {!pathValid && <p className="text-[11px] text-amber">Enter a real {os === "windows" ? "drive-qualified or UNC" : "rooted"} absolute path before copying the configuration.</p>}
        </div>
      )}

      {snapshot.transport !== "stdio" && <div className="space-y-2">
        <Label htmlFor="installation-endpoint">Client-reachable MCP endpoint</Label>
        <Input id="installation-endpoint" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setVerified(false); }} className="text-xs" />
        <p className="text-[11px] text-muted-foreground">Use localhost for a server on this machine, or your deployed HTTPS URL. A listener address such as 0.0.0.0 is not a public URL. Claude Desktop remote connectors require separate client setup and are omitted here.</p>
        {snapshot.mcpAuthType === "bearer" && <p className="text-[11px] text-muted-foreground">Set MCP_AUTH_TOKEN on the server. Replace the token placeholder in the client Authorization header with that same value. It is separate from upstream API credentials.</p>}
      </div>}
      <ol className="space-y-5">
        <li className="grid gap-3 sm:grid-cols-[28px_1fr]">
          <span className="flex size-7 items-center justify-center border border-primary/40 text-xs text-primary">1</span>
          <div>
            <h3 className="text-sm font-medium">Install the generated project</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Extract the archive, run <code className="text-foreground">{installCommand}</code>, copy <code className="text-foreground">.env.example</code> to <code className="text-foreground">.env</code>, and fill the named upstream credentials shown in that file. For stdio, also replace the credential placeholders in the client configuration below.{snapshot.transport !== "stdio" ? <> Then start it with <code className="text-foreground">{runCommand}</code>.</> : null}</p>
          </div>
        </li>

        <li className="grid gap-3 sm:grid-cols-[28px_1fr]">
          <span className="flex size-7 items-center justify-center border border-primary/40 text-xs text-primary">2</span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Register with {clientLabels[client]}</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">{location}</p>
            <div className="mt-3 border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{config.language}</span>
                <CopyButton value={config.value} onCopied={() => trackEvent("installation_instructions_copied", { client, language: snapshot.language, transport: snapshot.transport, instruction: "registration" })} />
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed">{config.value}</pre>
            </div>
          </div>
        </li>

        <li className="grid gap-3 sm:grid-cols-[28px_1fr]">
          <span className="flex size-7 items-center justify-center border border-primary/40 text-xs text-primary">3</span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Verify the connection</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Run this check after restarting the client. The HTTP command checks MCP initialization. For a full check, open MCP Inspector, select the endpoint/transport and Authorization header, list tools, and complete a safe read-only tool call. For Claude Code, the command checks registration; complete the tool call in the client.</p>
            <div className="mt-3 flex items-start gap-2 border border-border bg-background p-3">
              <Terminal className="mt-0.5 size-4 shrink-0 text-primary" />
              <code className="min-w-0 flex-1 break-all text-[11px] text-foreground">{checkCommand}</code>
              <CopyButton value={checkCommand} onCopied={() => trackEvent("installation_instructions_copied", { client, language: snapshot.language, transport: snapshot.transport, instruction: "connection_check" })} />
            </div>
            <div className="mt-4 flex items-start gap-3 border border-border px-3 py-3">
              <Checkbox id="installation-verified" checked={verified} onCheckedChange={(checked) => { setVerified(checked === true); if (checked === true) trackEvent("first_tool_call_completed", { client, language: snapshot.language, transport: snapshot.transport, confirmation: "self_reported" }); }} className="mt-0.5" />
              <div>
                <Label htmlFor="installation-verified" className="cursor-pointer text-xs">The client lists <strong>{snapshot.serverName}</strong> and a tool call completed.</Label>
                <p className="mt-1 text-[10px] text-muted-foreground">This is your self-reported connection checkpoint. A listed server without a completed tool call is not considered verified.</p>
              </div>
            </div>
          </div>
        </li>
      </ol>

      <div className={`flex items-center gap-3 border px-4 py-3 ${verified ? "border-green/30 text-green" : "border-border text-muted-foreground"}`} role="status">
        {verified ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        <span className="text-xs">{verified ? `${clientLabels[client]} connection confirmed by you` : "Connection verification pending"}</span>
        <Monitor className="ml-auto size-4" aria-hidden="true" />
      </div>
    </div>
  );
}
