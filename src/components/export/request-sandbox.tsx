"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AuthConfig } from "@/store/project-store";
import type { GenerationTool } from "@/lib/generator/types";
import {
  createMockMcpResponse,
  executeInspectedRequest,
  inspectToolRequest,
  sampleArguments,
  type InspectedHttpRequest,
  type McpSandboxResponse,
} from "@/lib/sandbox/request";

function addAuth(
  request: InspectedHttpRequest,
  auth: AuthConfig,
  value: string,
): InspectedHttpRequest {
  if (auth.type === "none" || !value) return request;
  const next = { ...request, headers: { ...request.headers } };
  if (auth.type === "bearer") next.headers.Authorization = `Bearer ${value}`;
  if (auth.type === "basic") next.headers.Authorization = `Basic ${btoa(value)}`;
  if (auth.type === "apiKey") {
    const key = auth.apiKey?.name || "X-API-Key";
    if (auth.apiKey?.in === "query") {
      const url = new URL(next.url);
      url.searchParams.set(key, value);
      next.url = url.toString();
    } else if (auth.apiKey?.in === "cookie") {
      next.headers.Cookie = [next.headers.Cookie, `${encodeURIComponent(key)}=${encodeURIComponent(value)}`].filter(Boolean).join("; ");
    } else {
      next.headers[key] = value;
    }
  }
  return next;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function RequestSandbox({ tools, baseUrl, authConfig }: {
  tools: GenerationTool[];
  baseUrl: string;
  authConfig: AuthConfig;
}) {
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const [selectedId, setSelectedId] = useState(tools[0]?.id || "");
  const selectedTool = tools.find((tool) => tool.id === selectedId) || tools[0];
  const sample = useMemo(() => selectedTool ? sampleArguments(selectedTool) : {}, [selectedTool]);
  const [argumentsText, setArgumentsText] = useState(() => pretty(sample));
  const [authValue, setAuthValue] = useState("");
  const [mockStatus, setMockStatus] = useState("200");
  const [mockBody, setMockBody] = useState('{\n  "ok": true\n}');
  const [request, setRequest] = useState<InspectedHttpRequest | null>(null);
  const [response, setResponse] = useState<McpSandboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [mutationAccepted, setMutationAccepted] = useState(false);
  const isMutation = selectedTool ? !["GET", "HEAD"].includes(selectedTool.method) : false;

  const resetForTool = (toolId: string) => {
    requestController.current?.abort();
    const tool = tools.find((candidate) => candidate.id === toolId);
    setSelectedId(toolId);
    setArgumentsText(pretty(tool ? sampleArguments(tool) : {}));
    setRequest(null);
    setResponse(null);
    setError(null);
    setMutationAccepted(false);
  };

  const inspect = (): InspectedHttpRequest | null => {
    setError(null);
    setResponse(null);
    try {
      if (!selectedTool) throw new Error("Select a tool to test.");
      if (!baseUrl) throw new Error("The imported specification does not define a base URL.");
      const parsed = JSON.parse(argumentsText) as unknown;
      const inspected = inspectToolRequest(selectedTool, baseUrl, parsed);
      const redacted = addAuth(inspected, authConfig, authValue ? "<redacted>" : "");
      setRequest(redacted);
      return inspected;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect request");
      return null;
    }
  };

  const runMock = () => {
    const inspected = inspect();
    if (!inspected) return;
    try {
      let parsed: unknown = mockBody;
      try { parsed = JSON.parse(mockBody); } catch { /* keep text */ }
      setResponse(createMockMcpResponse(Number(mockStatus) || 200, parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create mock response");
    }
  };

  const runLive = async () => {
    const inspected = inspect();
    if (!inspected) return;
    if (isMutation && !mutationAccepted) {
      setError("Confirm the state-changing request before executing it.");
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsExecuting(true);
    try {
      const authenticated = addAuth(inspected, authConfig, authValue);
      setResponse(await executeInspectedRequest(authenticated, baseUrl, controller.signal));
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Live request failed");
    } finally {
      setIsExecuting(false);
    }
  };

  if (tools.length === 0) return <p className="text-xs text-muted-foreground">Select at least one endpoint to use the sandbox.</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 border border-border bg-background px-4 py-3">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-blue" aria-hidden="true" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Inspection and mocks stay local. Live execution uses the stored method and path, is restricted to the imported base origin, omits browser credentials, rejects redirects, times out after 10 seconds, and caps responses at 256 KiB.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sandbox-tool" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Tool</Label>
        <select
          id="sandbox-tool"
          value={selectedTool?.id || ""}
          onChange={(event) => resetForTool(event.target.value)}
          className="h-10 w-full border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
        >
          {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.method} {tool.path} · {tool.displayName}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sandbox-arguments" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sample arguments (JSON)</Label>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => setArgumentsText(pretty(sample))}>
            <RotateCcw className="mr-1.5 size-3" />Reset sample
          </Button>
        </div>
        <Textarea id="sandbox-arguments" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} spellCheck={false} className="min-h-36 rounded-none bg-background font-mono text-xs" />
      </div>

      {authConfig.type !== "none" && (
        <div className="space-y-1.5">
          <Label htmlFor="sandbox-auth" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Ephemeral {authConfig.type === "apiKey" ? "API key" : authConfig.type === "basic" ? "username:password" : "bearer token"}
          </Label>
          <Input id="sandbox-auth" type="password" value={authValue} onChange={(event) => setAuthValue(event.target.value)} autoComplete="off" className="h-9 rounded-none bg-background text-xs" />
          <p className="text-[10px] text-muted-foreground">Kept only in this component state, never persisted, and redacted from the request preview.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" onClick={() => { inspect(); }} className="h-10 text-xs">Inspect request</Button>
        <Button type="button" variant="outline" onClick={runMock} className="h-10 text-xs">Run mock</Button>
        <Button type="button" variant="outline" onClick={() => { void runLive(); }} disabled={isExecuting} className="h-10 text-xs">
          {isExecuting ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <Play className="mr-2 size-3.5" />}
          Execute live
        </Button>
      </div>

      {isMutation && (
        <div className="flex items-start gap-3 border border-amber/30 px-3 py-3">
          <Checkbox id="sandbox-mutation" checked={mutationAccepted} onCheckedChange={(checked) => setMutationAccepted(checked === true)} className="mt-0.5" />
          <div>
            <Label htmlFor="sandbox-mutation" className="cursor-pointer text-xs">Allow this state-changing {selectedTool?.method} request.</Label>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Live execution may modify real upstream data. Inspect the exact request first.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Outgoing HTTP request</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed text-foreground">{request ? pretty(request) : "Inspect a request to see its exact method, URL, headers, and body."}</pre>
        </div>
        <div className="min-w-0 border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MCP response envelope</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed text-foreground">{response ? pretty(response) : "Run a mock or live request to inspect the MCP-shaped response."}</pre>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="mock-status" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mock status</Label>
          <Input id="mock-status" inputMode="numeric" value={mockStatus} onChange={(event) => setMockStatus(event.target.value)} className="h-9 rounded-none bg-background text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mock-body" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mock response body</Label>
          <Textarea id="mock-body" value={mockBody} onChange={(event) => setMockBody(event.target.value)} spellCheck={false} className="min-h-24 rounded-none bg-background font-mono text-xs" />
        </div>
      </div>

      {error && <p role="alert" className="border border-red/30 px-3 py-2 text-xs text-red">{error}</p>}
    </div>
  );
}
