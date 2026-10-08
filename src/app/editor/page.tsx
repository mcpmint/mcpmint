"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  AlertTriangle,
  X,
  Layers,
  FileUp,
  ShieldCheck,
} from "lucide-react";
import { Header } from "@/components/shared/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore, ParsedEndpoint } from "@/store/project-store";
import {
  consumeValidationSummary,
  type ValidationSummary,
} from "@/lib/parsers/validation";
import type { ValidationMessage } from "@/lib/parsers/validation";
import {
  estimateToolDefinitionTokens,
  estimateCompactModeTokens,
  formatTokens,
  type BudgetBand,
} from "@/lib/token-estimate";
import { selectOperationIds, type SelectionPreset } from "@/lib/capabilities";
import { useProcessing } from "@/hooks/use-processing";
import type { PreparedImport } from "@/lib/processing/types";
import { useHydratedProject } from "@/hooks/use-hydrated-project";
import { ProcessingOverlay } from "@/components/shared/processing-overlay";

export default function EditorPage() {
  const router = useRouter();
  const hydrated = useHydratedProject();
  const processing = useProcessing();
  const { run } = processing;
  const [page, setPage] = useState(0);
  const {
    spec,
    tools,
    toggleTool,
    setToolsEnabled,
    capabilityReport,
    endpointWarnings: savedWarnings,
    updateToolConfig,
    setCurrentStep,
    exportConfig,
    setExportConfig,
    regenerateSpec,
    lastSpecDiff,
    setError,
  } = useProjectStore();

  const compactMode = exportConfig.compactMode;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethodFilters, setSelectedMethodFilters] = useState<string[]>(
    [],
  );
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Pick up the one-time validation summary stashed by the import step. Lazy
  // initializer so the read-and-clear happens exactly once on mount (guarded
  // against SSR inside consumeValidationSummary).
  const [validationSummary] = useState<ValidationSummary | null>(() =>
    consumeValidationSummary(),
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const regenerateInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hydrated && !spec) router.replace("/import");
  }, [spec, router, hydrated]);

  // Index per-endpoint validation warnings ("METHOD /path" -> messages).
  // Recomputed only when the spec changes, so it's cheap during interaction.
  const endpointWarnings = useMemo(
    () => new Map<string, ValidationMessage[]>(savedWarnings || []),
    [savedWarnings],
  );

  // Live context-budget estimate. In compact mode the model only ever sees the
  // three fixed meta-tools, so the cost is constant regardless of how many
  // endpoints are enabled — we swap in the compact estimate. Otherwise it is
  // the sum of every enabled tool's definition. Recomputes whenever a tool
  // toggles or its config changes, since `tools` is a fresh array each time.
  const fullBudget = useMemo(
    () => estimateToolDefinitionTokens(tools),
    [tools],
  );
  const compactBudget = useMemo(
    () => estimateCompactModeTokens(fullBudget.enabledCount),
    [fullBudget.enabledCount],
  );
  const budget = compactMode ? compactBudget : fullBudget;
  useEffect(() => {
    if (!hydrated || !spec || capabilityReport) return;
    let active = true;
    run<import("@/lib/processing/types").PreparedAnalysis>({
      action: "capabilities",
      spec,
    })
      .then((report) => {
        if (active && useProjectStore.getState().spec === spec)
          useProjectStore.setState({
            capabilityReport: report.capabilities,
            endpointWarnings: report.warnings,
          });
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [hydrated, spec, capabilityReport, run, setError]);
  const capabilitiesById = useMemo(
    () =>
      new Map(
        capabilityReport?.operations.map((operation) => [
          operation.operationId,
          operation,
        ]) || [],
      ),
    [capabilityReport],
  );
  const toolsById = useMemo(
    () => new Map(tools.map((tool) => [tool.endpointId, tool])),
    [tools],
  );

  if (!hydrated || !spec)
    return (
      <div role="status" className="p-8">
        Restoring your project…
      </div>
    );

  const filteredEndpoints = spec.endpoints.filter((ep) => {
    const matchesSearch =
      !searchQuery ||
      ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.operationId?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod =
      selectedMethodFilters.length === 0 ||
      selectedMethodFilters.includes(ep.method);
    const matchesTag = !selectedTag || (ep.tags || []).includes(selectedTag);
    return matchesSearch && matchesMethod && matchesTag;
  });
  const availableTags = [
    ...new Set(spec.endpoints.flatMap((endpoint) => endpoint.tags || [])),
  ].sort();
  const groupedEndpoints = [...filteredEndpoints].sort(
    (left, right) =>
      (left.tags?.[0] || "Untagged").localeCompare(
        right.tags?.[0] || "Untagged",
      ) || left.path.localeCompare(right.path),
  );

  const pageCount = Math.max(1, Math.ceil(groupedEndpoints.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  const displayedEndpoints = groupedEndpoints.slice(
    currentPage * 100,
    (currentPage + 1) * 100,
  );
  const selectedCount = tools.filter((t) => t.enabled).length;
  const visibleToolIds = new Set(
    filteredEndpoints.map((endpoint) => endpoint.id),
  );
  const visibleTools = tools.filter((tool) =>
    visibleToolIds.has(tool.endpointId),
  );
  const allVisibleSelected =
    visibleTools.length > 0 && visibleTools.every((tool) => tool.enabled);

  const toggleMethodFilter = (m: string) =>
    setSelectedMethodFilters((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

  const toggleVisibleTools = (enabled: boolean) => {
    setToolsEnabled(
      visibleTools.map((tool) => tool.endpointId),
      enabled,
    );
  };

  const applyPreset = (preset: SelectionPreset) => {
    if (!capabilityReport) return;
    const selected = selectOperationIds(capabilityReport, preset);
    setToolsEnabled([...selected], true, true);
    if (preset === "recommended") setExportConfig({ compactMode: false });
    if (preset === "all-supported" && capabilityReport.operations.length > 25)
      setExportConfig({ compactMode: true });
  };

  const handleRegenerate = async (file: File | undefined) => {
    if (!file) return;
    try {
      setError(null);
      const prepared = await processing.run<PreparedImport>({
        action: "parse",
        file,
        filename: file.name,
      });
      regenerateSpec(prepared.spec, file.name, prepared);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not import the updated specification.",
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      {processing.isProcessing && (
        <ProcessingOverlay
          stage={processing.stage}
          cancel={processing.cancel}
        />
      )}

      <main className="pt-14 flex-1 flex flex-col relative z-10">
        {/* Validation summary banner (one-time, from the import step) */}
        {validationSummary && !bannerDismissed && (
          <div
            className={`border-b ${
              validationSummary.errorCount > 0
                ? "border-red/40 bg-red/[0.06]"
                : validationSummary.warningCount > 0
                  ? "border-amber/40 bg-amber/[0.06]"
                  : "border-green/40 bg-green/[0.06]"
            }`}
          >
            <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex items-start gap-3">
              <AlertTriangle
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  validationSummary.errorCount > 0
                    ? "text-red"
                    : validationSummary.warningCount > 0
                      ? "text-amber"
                      : "text-green"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">
                  {validationSummary.headline}
                </p>
                {validationSummary.notable.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {validationSummary.notable.map((item, i) => (
                      <li
                        key={i}
                        className="text-[11px] text-muted-foreground truncate"
                      >
                        · {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={() => setBannerDismissed(true)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {lastSpecDiff && (
          <div className="border-b border-primary/30 bg-primary/[0.04]">
            <div className="mx-auto max-w-[1400px] px-3 py-3 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">
                    Spec regenerated · v{lastSpecDiff.oldVersion || "?"} → v
                    {lastSpecDiff.newVersion || "?"}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {lastSpecDiff.added} added · {lastSpecDiff.changed} changed
                    · {lastSpecDiff.removed} removed · existing names and
                    selections preserved by method + path
                  </p>
                </div>
                <details className="text-[11px]">
                  <summary className="cursor-pointer uppercase tracking-wider text-primary">
                    Review drift
                  </summary>
                  <ul className="mt-2 max-h-40 min-w-[280px] space-y-1 overflow-auto border border-border bg-background p-3">
                    {lastSpecDiff.changes.map((change) => (
                      <li key={`${change.kind}-${change.key}`}>
                        <span className="uppercase text-muted-foreground">
                          {change.kind}
                        </span>{" "}
                        · {change.key}: {change.details.join("; ")}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </div>
        )}

        {capabilityReport && (
          <div className="border-b border-border bg-background">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-3 py-2 sm:px-6">
              <button
                type="button"
                onClick={() => setShowCapabilities((value) => !value)}
                aria-expanded={showCapabilities}
                className="mr-auto flex min-h-9 items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-primary"
              >
                <ShieldCheck className="size-3.5" /> Capability report ·{" "}
                {capabilityReport.supported} ready ·{" "}
                {capabilityReport.manualReview} review ·{" "}
                {capabilityReport.unsupported} unsupported
              </button>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Presets
              </span>
              {(
                [
                  ["recommended", "Recommended"],
                  ["read-only", "Read only"],
                  ["crud", "CRUD"],
                  ["all-supported", "All supported"],
                  ["none", "None"],
                ] as [SelectionPreset, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyPreset(value)}
                  className="min-h-9 border border-border px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-primary/40 hover:text-primary"
                >
                  {label}
                </button>
              ))}
              <input
                ref={regenerateInput}
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml"
                className="sr-only"
                onChange={(event) => {
                  void handleRegenerate(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => regenerateInput.current?.click()}
                className="flex min-h-9 items-center gap-1.5 border border-primary/40 px-2.5 text-[10px] uppercase tracking-wider text-primary hover:bg-primary/10"
              >
                <FileUp className="size-3.5" /> Update spec
              </button>
            </div>
            {showCapabilities && (
              <div className="mx-auto max-w-[1400px] px-3 pb-3 sm:px-6">
                <p className="mb-2 text-xs text-muted-foreground">
                  Showing up to 100 operations that need attention. Every
                  operation remains available in the paginated endpoint list.
                </p>
                <div className="max-h-64 overflow-auto border border-border">
                  {capabilityReport.operations
                    .filter(
                      (item) =>
                        item.status !== "supported" || item.risk === "high",
                    )
                    .slice(0, 100)
                    .map((item) => (
                      <div
                        key={item.operationId}
                        className="grid gap-1 border-b border-border px-3 py-2 text-[11px] last:border-b-0 md:grid-cols-[90px_1fr_120px_1fr]"
                      >
                        <span
                          className={
                            item.status === "unsupported"
                              ? "text-red"
                              : item.status === "manual-review"
                                ? "text-amber"
                                : "text-muted-foreground"
                          }
                        >
                          {item.status}
                        </span>
                        <code>
                          {item.method} {item.path}
                        </code>
                        <span>
                          {item.risk} risk · {item.auth} auth
                        </span>
                        <span className="text-muted-foreground">
                          {item.reasons.join("; ") ||
                            "Destructive operation; select intentionally."}
                        </span>
                      </div>
                    ))}
                  {capabilityReport.operations.every(
                    (item) =>
                      item.status === "supported" && item.risk !== "high",
                  ) && (
                    <p className="p-3 text-xs text-muted-foreground">
                      Every operation is supported with no high-risk items.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="border-b border-border bg-surface sticky top-14 z-20">
          <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-3 flex items-center gap-3 sm:gap-4 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-full sm:min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search endpoints..."
                aria-label="Search endpoints"
                className="pl-9 h-11 sm:h-8 bg-background border-border text-xs focus:border-primary"
              />
            </div>

            {/* Method filters */}
            <div className="flex gap-1 overflow-x-auto max-w-full pb-1 sm:pb-0">
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <button
                  key={m}
                  onClick={() => toggleMethodFilter(m)}
                  aria-pressed={selectedMethodFilters.includes(m)}
                  className={`
                    min-h-11 sm:min-h-0 px-2.5 py-1 text-[10px] font-semibold tracking-wider transition-all
                    ${
                      selectedMethodFilters.includes(m)
                        ? getMethodClasses(m as ParsedEndpoint["method"])
                        : "text-muted-foreground hover:text-foreground bg-transparent border border-transparent hover:border-border"
                    }
                  `}
                >
                  {m}
                </button>
              ))}
            </div>

            {availableTags.length > 0 && (
              <div
                className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:pb-0"
                aria-label="Filter endpoints by tag"
              >
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  aria-pressed={selectedTag === null}
                  className={`min-h-9 px-2 text-[10px] uppercase tracking-wider ${selectedTag === null ? "border border-primary text-primary" : "border border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  All tags
                </button>
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    aria-pressed={selectedTag === tag}
                    className={`min-h-9 whitespace-nowrap px-2 text-[10px] uppercase tracking-wider ${selectedTag === tag ? "border border-primary text-primary" : "border border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Select all */}
            <button
              onClick={() => toggleVisibleTools(!allVisibleSelected)}
              disabled={visibleTools.length === 0}
              className="min-h-11 sm:min-h-0 px-2 flex items-center gap-1.5 text-[11px] tracking-wider text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              {allVisibleSelected ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <CheckSquare className="w-3.5 h-3.5" />
              )}
              {allVisibleSelected ? "NONE VISIBLE" : "ALL VISIBLE"}
            </button>
          </div>
        </div>

        {/* Table header */}
        <div className="hidden md:block border-b border-border bg-surface/50">
          <div className="max-w-[1400px] mx-auto px-3 sm:px-6">
            <div className="grid grid-cols-[40px_70px_1fr_180px_80px_40px] gap-4 py-2 text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
              <span></span>
              <span>Method</span>
              <span>Path</span>
              <span>Tool Name</span>
              <span>Params</span>
              <span></span>
            </div>
          </div>
        </div>

        {/* Endpoint rows */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-3 sm:px-6">
            {pageCount > 1 && (
              <nav
                aria-label="Endpoint pages"
                className="flex items-center gap-4 p-4"
              >
                <Button
                  variant="outline"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {currentPage + 1} of {pageCount} · 100 endpoints per page
                </span>
                <Button
                  variant="outline"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
            {displayedEndpoints.map((ep, endpointIndex) => {
              const tool = toolsById.get(ep.id);
              if (!tool) return null;
              const isExpanded = expandedId === ep.id;
              const visibleParamCount = tool.parameters.filter(
                (param) => !param.hidden,
              ).length;
              const warnings =
                endpointWarnings.get(`${ep.method} ${ep.path}`) ?? [];
              const capability = capabilitiesById.get(ep.id);
              const domId = ep.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
              const groupName = ep.tags?.[0] || "Untagged";
              const previousGroup =
                endpointIndex > 0
                  ? displayedEndpoints[endpointIndex - 1].tags?.[0] ||
                    "Untagged"
                  : null;

              return (
                <div key={ep.id} className="border-b border-border">
                  {groupName !== previousGroup && (
                    <div className="border-b border-border bg-surface/60 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {groupName} ·{" "}
                      {
                        groupedEndpoints.filter(
                          (candidate) =>
                            (candidate.tags?.[0] || "Untagged") === groupName,
                        ).length
                      }
                    </div>
                  )}
                  {/* Row */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={`endpoint-details-${domId}`}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${ep.method} ${ep.path}`}
                    className={`
                      grid grid-cols-[44px_64px_minmax(0,1fr)_32px] md:grid-cols-[40px_70px_1fr_180px_80px_40px] gap-2 md:gap-4 py-3 items-center cursor-pointer transition-colors
                      ${tool.enabled ? "bg-primary/[0.03]" : "hover:bg-surface/50"}
                      ${isExpanded ? "bg-surface" : ""}
                    `}
                    onClick={() => setExpandedId(isExpanded ? null : ep.id)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedId(isExpanded ? null : ep.id);
                      }
                    }}
                  >
                    {/* Checkbox */}
                    <div className="min-h-11 flex items-center justify-center">
                      <Checkbox
                        checked={tool.enabled}
                        onCheckedChange={() => toggleTool(ep.id)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label={`Include ${ep.method} ${ep.path}`}
                        className="size-6"
                      />
                    </div>

                    {/* Method */}
                    <Badge
                      className={`${getMethodClasses(ep.method)} text-[10px] font-bold tracking-wider w-fit`}
                    >
                      {ep.method}
                    </Badge>

                    {/* Path */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <code className="text-xs truncate">{ep.path}</code>
                        {warnings.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                aria-label={`${warnings.length} validation warning${warnings.length === 1 ? "" : "s"} for ${ep.method} ${ep.path}`}
                                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber/10 border border-amber/40 text-amber text-[9px] font-semibold tracking-wider uppercase cursor-help"
                              >
                                <AlertTriangle className="w-2.5 h-2.5" />
                                {warnings.length}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-left">
                              <ul className="space-y-1">
                                {warnings.map((w, i) => (
                                  <li
                                    key={i}
                                    className="text-[11px] leading-snug"
                                  >
                                    {w.message}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {ep.summary && (
                        <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                          {ep.summary}
                        </span>
                      )}
                      {capability &&
                        (capability.status !== "supported" ||
                          capability.risk === "high") && (
                          <span
                            className={`mt-1 inline-block text-[9px] uppercase tracking-wider ${capability.status === "manual-review" ? "text-amber" : capability.status === "unsupported" ? "text-red" : "text-muted-foreground"}`}
                          >
                            {capability.status === "supported"
                              ? capability.risk
                              : capability.status}
                          </span>
                        )}
                      <span className="md:hidden text-[10px] text-muted-foreground truncate block mt-1">
                        {tool.toolName} · {visibleParamCount} param
                        {visibleParamCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Tool name */}
                    <code
                      className={`hidden md:block text-[11px] truncate ${tool.enabled ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {tool.toolName}
                    </code>

                    {/* Params */}
                    <span className="hidden md:block text-[11px] text-muted-foreground">
                      {visibleParamCount} param
                      {visibleParamCount !== 1 ? "s" : ""}
                    </span>

                    {/* Expand arrow */}
                    <div className="flex justify-center">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>

                  {/* Inline expansion */}
                  {isExpanded && (
                    <div
                      id={`endpoint-details-${domId}`}
                      className="animate-expand bg-surface border-t border-border px-3 sm:px-6 py-5"
                    >
                      <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
                        {/* Tool Name */}
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`tool-name-${domId}`}
                            className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase"
                          >
                            Tool Name
                          </Label>
                          <Input
                            id={`tool-name-${domId}`}
                            value={tool.toolName}
                            onChange={(e) =>
                              updateToolConfig(ep.id, {
                                toolName: e.target.value,
                              })
                            }
                            className="h-8 bg-background border-border text-xs focus:border-primary"
                          />
                        </div>

                        {/* Enable */}
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`tool-description-${domId}`}
                            className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase"
                          >
                            Status
                          </Label>
                          <Button
                            variant={tool.enabled ? "default" : "outline"}
                            size="sm"
                            className={`w-full text-xs ${tool.enabled ? "bg-primary text-primary-foreground" : "border-border"}`}
                            onClick={() =>
                              updateToolConfig(ep.id, {
                                enabled: !tool.enabled,
                              })
                            }
                          >
                            {tool.enabled ? "Enabled" : "Disabled"}
                          </Button>
                        </div>

                        {/* Description */}
                        <div className="space-y-1.5 md:col-span-2">
                          <Label className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                            Description
                          </Label>
                          <Textarea
                            id={`tool-description-${domId}`}
                            value={tool.description}
                            onChange={(e) =>
                              updateToolConfig(ep.id, {
                                description: e.target.value,
                              })
                            }
                            className="min-h-[60px] bg-background border-border text-xs resize-none focus:border-primary"
                          />
                        </div>

                        {/* Parameters */}
                        {tool.parameters.length > 0 && (
                          <div className="md:col-span-2 space-y-2">
                            <Label className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                              Parameters ({tool.parameters.length})
                            </Label>
                            <div className="space-y-2 max-h-[250px] overflow-y-auto">
                              {tool.parameters.map((param, idx) => (
                                <div
                                  key={`${param.originalName}-${idx}`}
                                  className="flex flex-wrap sm:flex-nowrap items-center gap-3 py-2 border-b border-border last:border-0"
                                >
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] w-12 justify-center ${getLocationClasses(param.location)}`}
                                  >
                                    {param.location}
                                  </Badge>
                                  <Input
                                    aria-label={`Parameter name for ${param.originalName}`}
                                    value={param.name}
                                    onChange={(e) => {
                                      const newParams = [...tool.parameters];
                                      newParams[idx] = {
                                        ...param,
                                        name: e.target.value,
                                      };
                                      updateToolConfig(ep.id, {
                                        parameters: newParams,
                                      });
                                    }}
                                    disabled={param.hidden}
                                    className="h-9 w-32 bg-background border-border text-[11px] focus:border-primary"
                                  />
                                  <span className="text-[10px] text-muted-foreground">
                                    {param.type}
                                  </span>
                                  {param.required && (
                                    <span className="text-[9px] text-amber tracking-wider uppercase">
                                      req
                                    </span>
                                  )}
                                  <Input
                                    aria-label={`Description for parameter ${param.originalName}`}
                                    value={param.description}
                                    onChange={(e) => {
                                      const newParams = [...tool.parameters];
                                      newParams[idx] = {
                                        ...param,
                                        description: e.target.value,
                                      };
                                      updateToolConfig(ep.id, {
                                        parameters: newParams,
                                      });
                                    }}
                                    disabled={param.hidden}
                                    className="h-9 min-w-full sm:min-w-0 flex-1 bg-background border-border text-[11px] focus:border-primary"
                                    placeholder="Description..."
                                  />
                                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
                                    <Checkbox
                                      checked={!param.hidden}
                                      disabled={
                                        param.location === "path" &&
                                        param.required
                                      }
                                      onCheckedChange={(checked) => {
                                        const newParams = [...tool.parameters];
                                        newParams[idx] = {
                                          ...param,
                                          hidden: !checked,
                                        };
                                        updateToolConfig(ep.id, {
                                          parameters: newParams,
                                        });
                                      }}
                                    />
                                    Use
                                  </label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredEndpoints.length === 0 && (
              <div className="py-20 text-center text-sm text-muted-foreground">
                No endpoints match your filters.
              </div>
            )}
          </div>
        </div>

        {/* Sticky bottom bar */}
        <div className="sticky bottom-0 border-t-2 border-primary bg-background z-20">
          <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setCurrentStep("import");
                router.push("/import");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-2" />
              Back
            </Button>

            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-6">
              {/* Compact mode toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    className={`min-h-11 sm:min-h-0 flex items-center gap-2 px-2.5 py-1 rounded-sm border cursor-pointer transition-colors ${
                      compactMode
                        ? "border-primary/50 bg-primary/[0.08] text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span className="text-[11px] tracking-wider uppercase font-semibold">
                      Compact
                    </span>
                    <Switch
                      checked={compactMode}
                      onCheckedChange={(checked) =>
                        setExportConfig({ compactMode: checked })
                      }
                      aria-label="Compact mode"
                      className="ml-0.5"
                    />
                  </label>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-left">
                  <p className="text-[11px] leading-snug">
                    Compact mode exposes just 3 meta-tools (
                    <code>list_api_endpoints</code>,{" "}
                    <code>get_api_endpoint_schema</code>,{" "}
                    <code>invoke_api_endpoint</code>) instead of one tool per
                    operation.
                  </p>
                  <p className="text-[10px] leading-snug mt-1.5 opacity-70">
                    The model discovers and calls endpoints on demand, so a
                    large API costs a tiny, constant amount of context instead
                    of ballooning with every enabled tool.
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Context-budget meter */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`min-h-11 sm:min-h-0 flex items-center gap-2 px-2.5 py-1 rounded-sm border cursor-help ${budgetClasses(budget.band)}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${budgetDotClasses(budget.band)}`}
                      aria-hidden
                    />
                    <span className="text-[11px] tracking-wider uppercase font-semibold tabular-nums">
                      ~{formatTokens(budget.totalTokens)}
                    </span>
                    <span className="text-[10px] tracking-wider uppercase opacity-70">
                      ctx tokens
                    </span>
                    {compactMode ? (
                      <span className="text-[10px] tracking-wide normal-case opacity-90 hidden sm:inline">
                        · 3 meta-tools
                      </span>
                    ) : budget.band === "red" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExportConfig({ compactMode: true });
                        }}
                        className="text-[10px] tracking-wide normal-case opacity-90 underline underline-offset-2 hover:opacity-100 hidden sm:inline"
                      >
                        · Large tool set, try Compact mode
                      </button>
                    ) : null}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-left">
                  <p className="text-[11px] leading-snug">
                    Roughly how much of the model&apos;s context window your
                    tool list occupies before any real work. Fewer,
                    well-described tools = better agent accuracy.
                  </p>
                  {compactMode ? (
                    <p className="text-[10px] leading-snug mt-1.5 opacity-70">
                      Compact mode is on: just 3 meta-tools reach all{" "}
                      {budget.enabledCount} enabled endpoint
                      {budget.enabledCount !== 1 ? "s" : ""} on demand (~1 token
                      / 4 chars of tool JSON).
                    </p>
                  ) : (
                    <p className="text-[10px] leading-snug mt-1.5 opacity-70">
                      Estimated across {budget.enabledCount} enabled tool
                      {budget.enabledCount !== 1 ? "s" : ""} (~1 token / 4 chars
                      of tool JSON).
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>

              <span className="text-xs text-muted-foreground">
                <span className="text-primary font-semibold">
                  {selectedCount}
                </span>
                <span className="mx-1">/</span>
                <span>{tools.length}</span>
                <span className="ml-1.5 tracking-wider uppercase text-[10px]">
                  selected
                </span>
              </span>

              <Button
                onClick={() => {
                  setCurrentStep("export");
                  router.push("/export");
                }}
                disabled={selectedCount === 0}
                className="min-h-11 basis-full sm:basis-auto sm:flex-none bg-primary text-primary-foreground hover:bg-primary/90 px-8 font-semibold text-xs tracking-wider"
              >
                Continue
                <ArrowRight className="w-3.5 h-3.5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function getMethodClasses(method: ParsedEndpoint["method"]): string {
  const m: Record<string, string> = {
    GET: "method-get",
    POST: "method-post",
    PUT: "method-put",
    PATCH: "method-patch",
    DELETE: "method-delete",
  };
  return m[method] || "";
}

function budgetClasses(band: BudgetBand): string {
  const c: Record<BudgetBand, string> = {
    green: "border-green/40 bg-green/[0.06] text-green",
    amber: "border-amber/40 bg-amber/[0.06] text-amber",
    red: "border-red/40 bg-red/[0.08] text-red",
  };
  return c[band];
}

function budgetDotClasses(band: BudgetBand): string {
  const c: Record<BudgetBand, string> = {
    green: "bg-green",
    amber: "bg-amber",
    red: "bg-red",
  };
  return c[band];
}

function getLocationClasses(loc: string): string {
  const c: Record<string, string> = {
    path: "border-purple-500/40 text-purple-400",
    query: "border-blue/40 text-blue",
    header: "border-amber/40 text-amber",
    body: "border-green/40 text-green",
  };
  return c[loc] || "border-border text-muted-foreground";
}
