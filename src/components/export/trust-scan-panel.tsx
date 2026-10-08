"use client";

import { AlertTriangle, CheckCircle2, Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Finding, ScanReport, Severity } from "@/lib/scanner";

const severityStyle: Record<Severity, { text: string; border: string; icon: typeof ShieldCheck }> = {
  green: { text: "text-green", border: "border-green/30", icon: ShieldCheck },
  yellow: { text: "text-amber", border: "border-amber/30", icon: AlertTriangle },
  red: { text: "text-red", border: "border-red/30", icon: ShieldAlert },
};

function FindingRow({ finding }: { finding: Finding }) {
  const style = severityStyle[finding.severity];
  const Icon = style.icon;
  const affected = finding.parameterPath
    ? `${finding.toolName || "Tool"} · ${finding.parameterPath}`
    : finding.toolName || finding.relatedToolNames?.join(" + ") || "Tool set";

  return (
    <details className={`border ${style.border} bg-background`}>
      <summary className="min-h-11 cursor-pointer list-none px-3 py-2.5 flex items-start gap-3 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2">
        <Icon className={`mt-0.5 size-4 shrink-0 ${style.text}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={`block text-[10px] uppercase tracking-[0.16em] ${style.text}`}>
            {finding.severity} · {finding.check.replaceAll("_", " ")}
          </span>
          <span className="block mt-1 text-xs text-foreground break-words">{finding.message}</span>
          <span className="block mt-1 text-[11px] text-muted-foreground break-words">Affected: {affected}</span>
        </span>
      </summary>
      <div className="border-t border-border px-3 py-3 space-y-3 text-[11px] leading-relaxed">
        <div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Why it matters</div>
          <p className="mt-1 text-foreground">{finding.explanation}</p>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Remediation</div>
          <p className="mt-1 text-foreground">{finding.remediation}</p>
        </div>
        {finding.evidence && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
            <code className="mt-1 block whitespace-pre-wrap break-all text-muted-foreground">{finding.evidence}</code>
          </div>
        )}
      </div>
    </details>
  );
}

export function TrustScanPanel({
  report,
  riskAccepted,
  onRiskAcceptedChange,
  onDownloadAttestation,
}: {
  report: ScanReport;
  riskAccepted: boolean;
  onRiskAcceptedChange: (accepted: boolean) => void;
  onDownloadAttestation: () => void;
}) {
  const style = severityStyle[report.verdict];
  const VerdictIcon = style.icon;
  const redCount = report.findings.filter((finding) => finding.severity === "red").length;
  const yellowCount = report.findings.filter((finding) => finding.severity === "yellow").length;

  return (
    <div className="space-y-4" aria-live="polite">
      <div className={`border ${style.border} bg-background px-4 py-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <VerdictIcon className={`size-5 shrink-0 ${style.text}`} aria-hidden="true" />
            <div>
              <div className={`text-[10px] uppercase tracking-[0.18em] ${style.text}`}>
                {report.verdict} verdict
              </div>
              <div className="mt-1 text-lg font-semibold">Metadata score {report.score}/100</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {redCount} blocking · {yellowCount} review · {report.toolCount} tools scanned
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onDownloadAttestation} className="h-9 text-[10px] tracking-wider">
            <Download className="mr-2 size-3.5" />
            Attestation JSON
          </Button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">This heuristic scan reviews exported tool metadata. An attestation records that metadata and its findings; it does not verify the whole archive, dependencies, API behavior, or deployment.</p>

      {report.findings.length === 0 ? (
        <div className="flex items-center gap-3 border border-green/30 px-3 py-3 text-xs text-green">
          <CheckCircle2 className="size-4" />
          No findings in these five metadata checks. This does not certify the API or generated code as safe.
        </div>
      ) : (
        <div className="space-y-2">
          {report.findings.map((finding, index) => (
            <FindingRow key={`${finding.check}-${finding.toolName || "set"}-${finding.parameterPath || index}`} finding={finding} />
          ))}
        </div>
      )}

      {report.verdict === "red" && (
        <div className="border border-red/30 px-3 py-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="accept-trust-risk"
              checked={riskAccepted}
              onCheckedChange={(checked) => onRiskAcceptedChange(checked === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="accept-trust-risk" className="cursor-pointer text-xs text-foreground">
                I reviewed the red findings and accept the risk for this download.
              </Label>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Red findings block download until acknowledged. The attestation records this acceptance.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
