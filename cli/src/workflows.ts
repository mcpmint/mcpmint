import type { GeneratorRequest } from "../../src/lib/generator/types.ts";
import { buildGenerationPlan } from "../../src/lib/generator/normalize.ts";
import { createScanAttestation, scanTools, type ScanReport } from "../../src/lib/scanner/index.ts";
import { createMockMcpResponse, executeInspectedRequest, inspectToolRequest, sampleArguments } from "../../src/lib/sandbox/request.ts";

import { generationPlanToScanTools } from "../../src/lib/scanner/from-plan.ts";

export function scanRequest(request: GeneratorRequest): { report: ScanReport; subject: string } {
    const tools = generationPlanToScanTools(buildGenerationPlan(request));
    return { report: scanTools(tools), subject: JSON.stringify(tools) };
}

export function formatScan(report: ScanReport): string {
    const lines = [`Trust Scan: ${report.verdict.toUpperCase()} · ${report.score}/100 · ${report.toolCount} tools`];
    for (const finding of report.findings) {
        const affected = finding.parameterPath ? `${finding.toolName || "tool"}.${finding.parameterPath}` : finding.toolName || finding.relatedToolNames?.join(" + ") || "tool set";
        lines.push(`  [${finding.severity.toUpperCase()}] ${affected}: ${finding.message}`);
        lines.push(`    Why: ${finding.explanation}`);
        lines.push(`    Fix: ${finding.remediation}`);
    }
    if (report.findings.length === 0) lines.push("  No findings.");
    return lines.join("\n");
}

export async function createRequestAttestation(request: GeneratorRequest, source: string, riskAccepted: boolean): Promise<string> {
    const { report, subject } = scanRequest(request);
    const attestation = await createScanAttestation({ projectName: request.serverConfig.name, source, subject, report, riskAccepted });
    return `${JSON.stringify(attestation, null, 2)}\n`;
}

export async function testRequest(input: {
    request: GeneratorRequest;
    operationId: string;
    args?: Record<string, unknown>;
    live: boolean;
    allowMutation: boolean;
}): Promise<{ request: unknown; response: unknown }> {
    const plan = buildGenerationPlan(input.request);
    const tool = plan.tools.find((candidate) => candidate.id === input.operationId || candidate.functionName === input.operationId);
    if (!tool) throw new Error(`operation not found: ${input.operationId}`);
    if (input.live && tool.method !== "GET" && !input.allowMutation) {
        throw new Error(`live ${tool.method} requires --allow-mutation`);
    }
    const inspected = inspectToolRequest(tool, tool.baseUrl || plan.spec.baseUrl, input.args || sampleArguments(tool));
    const response = input.live
        ? await executeInspectedRequest(inspected, tool.baseUrl || plan.spec.baseUrl)
        : createMockMcpResponse(200, { ok: true, operationId: tool.id, mode: "mock" });
    return { request: inspected, response };
}
