import type { ParsedSpec, ToolConfig } from "../../store/project-store";
import type { ValidationSummary } from "../parsers/openapi";
import type { CapabilityReport } from "../capabilities";
import type { PortableProjectFile } from "../../store/project-file";

export interface PreparedImport {
  spec: ParsedSpec;
  tools: ToolConfig[];
  capabilities: CapabilityReport;
  summary: ValidationSummary;
  warnings: Array<
    [string, import("../parsers/validation").ValidationMessage[]]
  >;
}

export type ProcessingRequest =
  | { action: "parse"; file?: File; content?: string; filename: string }
  | { action: "project-import"; file?: File; content?: string }
  | { action: "project-validate"; project: PortableProjectFile }
  | { action: "project-export"; project: PortableProjectFile }
  | { action: "capabilities"; spec: ParsedSpec }
  | { action: "preview" | "generate" | "export-analysis"; payload: unknown };

export type ProcessingMessage<T = unknown> =
  | { type: "progress"; stage: string }
  | { type: "success"; result: T }
  | { type: "error"; error: string };

export interface ExportAnalysis {
  plan: import("../generator/types").GenerationPlan;
  trustTools: import("../scanner/types").ScanTool[];
  report: import("../scanner/types").ScanReport;
  manualReview: {
    id: string;
    label: string;
    toolName: string;
    reasons: string[];
  }[];
}

export interface PreparedAnalysis {
  capabilities: CapabilityReport;
  warnings: PreparedImport["warnings"];
}
