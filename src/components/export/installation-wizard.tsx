"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Circle, Loader2, Monitor, Network, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export interface InstallationSnapshot {
  serverName: string;
  language: "node" | "python";
  packageManager: "npm" | "pnpm" | "yarn";
  transport: "stdio" | "http" | "sse";
  host: string;
  port: number;
  authType: "apiKey" | "bearer" | "basic" | "none";
  baseUrl: string;
}

const osLabels: Record<ClientOperatingSystem, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };
const clientLabels: Record<McpClient, string> = {
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  "claude-code": "Claude Code",
  vscode: "VS Code",
};

function transportUrl(snapshot: InstallationSnapshot): string {
  if (snapshot.transport === "sse") return `http://${snapshot.host}:${snapshot.port}/sse`;
  return `http://${snapshot.host}:${snapshot.port}`;
}

function inputFor(snapshot: InstallationSnapshot, projectDirectory: string): McpClientConfigInput {
  if (snapshot.transport !== "stdio") {
    return { serverName: snapshot.serverName, transport: snapshot.transport, transportUrl: transportUrl(snapshot) };
  }
  const entrypoint = snapshot.language === "python"
    ? joinProjectPath(projectDirectory, "src/server.py")
    : joinProjectPath(projectDirectory, "dist/src/index.js");
  const env: Record<string, string> = { API_BASE_URL: snapshot.baseUrl || "https://api.example.com" };
  if (snapshot.authType === "apiKey") env.API_KEY = "your_api_key_here";
  if (snapshot.authType === "bearer") env.BEARER_TOKEN = "your_token_here";
  if (snapshot.authType === "basic") {
    env.BASIC_USERNAME = "your_username";
    env.BASIC_PASSWORD = "your_password";
  }
  return {
    serverName: snapshot.serverName,
    transport: "stdio",
    stdioCommand: snapshot.language === "python" ? "python" : "node",
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
  const detectedOs = useSyncExternalStore(() => () => {}, () => detectOperatingSystem(navigator.platform, navigator.userAgent), () => "macos" as ClientOperatingSystem);
  const [osOverride, setOs] = useState<ClientOperatingSystem | null>(null);
  const os = osOverride || detectedOs;
  const probeController = useRef<AbortController | null>(null);
  useEffect(() => () => probeController.current?.abort(), []);
  const [client, setClient] = useState<McpClient>("claude-desktop");
  const [projectDirectory, setProjectDirectory] = useState(`/absolute/path/to/${snapshot.serverName}`);
  const [verified, setVerified] = useState(false);
  const [probeState, setProbeState] = useState<"idle" | "loading" | "passed" | "failed">("idle");
  const [probeMessage, setProbeMessage] = useState("");


  const clientInput = useMemo(() => inputFor(snapshot, projectDirectory), [snapshot, projectDirectory]);
  const config = configFor(client, clientInput);
  const location = clientConfigLocation(client, os);
  const checkCommand = renderConnectionCheck(clientInput, client);
  const pathValid = snapshot.transport !== "stdio" || isAbsoluteProjectPath(projectDirectory, os);
  const installCommand = snapshot.language === "python" ? "pip install -e ." : `${snapshot.packageManager} install`;
  const runCommand = snapshot.language === "python"
    ? "python src/server.py"
    : snapshot.packageManager === "npm" ? "npm run dev" : `${snapshot.packageManager} dev`;

  const probe = async () => {
    setProbeState("loading");
    setProbeMessage("");
    probeController.current?.abort();
    const controller = new AbortController();
    probeController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(transportUrl(snapshot), {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      await response.body?.cancel();
      setProbeState("passed");
      setProbeMessage(`Server responded with HTTP ${response.status}. The endpoint is reachable from this browser.`);
    } catch (error) {
      setProbeState("failed");
      setProbeMessage(error instanceof Error ? error.message : "The endpoint could not be reached from this browser.");
    } finally {
      clearTimeout(timeout);
    }
  };

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
            {Object.entries(clientLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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

      <ol className="space-y-5">
        <li className="grid gap-3 sm:grid-cols-[28px_1fr]">
          <span className="flex size-7 items-center justify-center border border-primary/40 text-xs text-primary">1</span>
          <div>
            <h3 className="text-sm font-medium">Install the generated project</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Extract the archive, run <code className="text-foreground">{installCommand}</code>, copy <code className="text-foreground">.env.example</code> to <code className="text-foreground">.env</code>, and fill required upstream credentials.{snapshot.transport !== "stdio" ? <> Then start it with <code className="text-foreground">{runCommand}</code>.</> : null}</p>
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
                <CopyButton value={config.value} />
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed">{config.value}</pre>
            </div>
          </div>
        </li>

        <li className="grid gap-3 sm:grid-cols-[28px_1fr]">
          <span className="flex size-7 items-center justify-center border border-primary/40 text-xs text-primary">3</span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Verify the connection</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Run this check after restarting the client. It connects through the registered client or MCP Inspector rather than only validating JSON syntax.</p>
            <div className="mt-3 flex items-start gap-2 border border-border bg-background p-3">
              <Terminal className="mt-0.5 size-4 shrink-0 text-primary" />
              <code className="min-w-0 flex-1 break-all text-[11px] text-foreground">{checkCommand}</code>
              <CopyButton value={checkCommand} />
            </div>
            {snapshot.transport !== "stdio" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => { void probe(); }} disabled={probeState === "loading"} className="h-9 text-xs">
                  {probeState === "loading" ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <Network className="mr-2 size-3.5" />}
                  Probe server endpoint
                </Button>
                {probeMessage && <span className={`text-[11px] ${probeState === "passed" ? "text-green" : "text-amber"}`}>{probeMessage}</span>}
              </div>
            )}
            <div className="mt-4 flex items-start gap-3 border border-border px-3 py-3">
              <Checkbox id="installation-verified" checked={verified} onCheckedChange={(checked) => setVerified(checked === true)} className="mt-0.5" />
              <div>
                <Label htmlFor="installation-verified" className="cursor-pointer text-xs">The client lists <strong>{snapshot.serverName}</strong> and a tool call completed.</Label>
                <p className="mt-1 text-[10px] text-muted-foreground">This is the final connection checkpoint. A listed server without a completed tool call is not considered verified.</p>
              </div>
            </div>
          </div>
        </li>
      </ol>

      <div className={`flex items-center gap-3 border px-4 py-3 ${verified ? "border-green/30 text-green" : "border-border text-muted-foreground"}`} role="status">
        {verified ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        <span className="text-xs">{verified ? `${clientLabels[client]} connection verified` : "Connection verification pending"}</span>
        <Monitor className="ml-auto size-4" aria-hidden="true" />
      </div>
    </div>
  );
}
