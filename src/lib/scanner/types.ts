export type CheckId =
    | "HIDDEN_INSTRUCTIONS"
    | "SUSPICIOUS_PARAMS"
    | "TOOL_POISONING"
    | "BROAD_PERMISSIONS"
    | "EXFIL_COMBO";

export interface ScanTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    method?: string;
    path?: string;
    tags?: string[];
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
}

export type Severity = "green" | "yellow" | "red";

export interface Finding {
    check: CheckId;
    severity: Severity;
    toolName?: string;
    relatedToolNames?: string[];
    parameterPath?: string;
    message: string;
    explanation: string;
    remediation: string;
    evidence?: string;
}

export interface CheckResult {
    check: CheckId;
    severity: Severity;
    summary: string;
}

export interface ScanReport {
    schemaVersion: 1;
    score: number;
    verdict: Severity;
    toolCount: number;
    checks: CheckResult[];
    findings: Finding[];
}

export interface ScanAttestation {
    schemaVersion: 1;
    kind: "mcpmint-trust-attestation";
    generatedAt: string;
    subject: {
        projectName: string;
        source: string;
        sha256: string;
    };
    riskAccepted: boolean;
    report: ScanReport;
}
