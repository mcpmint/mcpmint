"use client";

import { useMemo, useState } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AuthConfig } from "@/store/project-store";
import type { GenerationTool } from "@/lib/generator/types";
import {
  createMockMcpResponse,
  inspectToolRequest,
  sampleArguments,
  type InspectedHttpRequest,
  type McpSandboxResponse,
} from "@/lib/sandbox/request";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function RequestSandbox({ tools, baseUrl }: {
  tools: GenerationTool[];
  baseUrl: string;
  authConfig: AuthConfig;
}) {
  const [selectedId, setSelectedId] = useState(tools[0]?.id || "");
  const selectedTool = tools.find((tool) => tool.id === selectedId) || tools[0];
  const sample = useMemo(() => selectedTool ? sampleArguments(selectedTool) : {}, [selectedTool]);
  const [argumentsText, setArgumentsText] = useState(() => pretty(sample));
  const [mockStatus, setMockStatus] = useState("200");
  const [mockBody, setMockBody] = useState('{\n  "ok": true\n}');
  const [request, setRequest] = useState<InspectedHttpRequest | null>(null);
  const [response, setResponse] = useState<McpSandboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetForTool = (toolId: string) => {
    const tool = tools.find((candidate) => candidate.id === toolId);
    setSelectedId(toolId);
    setArgumentsText(pretty(tool ? sampleArguments(tool) : {}));
    setRequest(null);
    setResponse(null);
    setError(null);
  };

  const inspect = (): InspectedHttpRequest | null => {
    setError(null);
    setResponse(null);
    try {
      if (!selectedTool) throw new Error("Select a tool to test.");
      if (!baseUrl) throw new Error("The imported specification does not define a base URL.");
      const parsed = JSON.parse(argumentsText) as unknown;
      const inspected = inspectToolRequest(selectedTool, baseUrl, parsed);
      setRequest(inspected);
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

  if (tools.length === 0) return <p className="text-xs text-muted-foreground">Select at least one endpoint to use the sandbox.</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 border border-border bg-background px-4 py-3">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-blue" aria-hidden="true" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Inspection and mocks stay in your browser. Authentication is configured by the generated server. To send real requests, use the local CLI or connect the generated server through MCP Inspector. Browsers can block API requests through CSP, CORS, and private-network rules. Cookie authentication is supported by the generated server.
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

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => { inspect(); }} className="h-10 text-xs">Inspect request</Button>
        <Button type="button" variant="outline" onClick={runMock} className="h-10 text-xs">Run mock</Button>
      </div>

      <p className="text-[11px] text-muted-foreground">Local live check: <code>mcpmint test --help</code>. Supply the original spec, operation ID, and arguments. Mutations require explicit permission. Use the generated server to verify your edited project and authentication.</p>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Outgoing HTTP request</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed text-foreground">{request ? pretty(request) : "Inspect a request to see its method, URL, configured headers, and body fields. Upstream auth is added by the generated server."}</pre>
        </div>
        <div className="min-w-0 border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">MCP response envelope</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-relaxed text-foreground">{response ? pretty(response) : "Run a mock request to inspect the MCP-shaped response."}</pre>
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
