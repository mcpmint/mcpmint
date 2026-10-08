import {
  assertGraphBudget,
  assertSpecFile,
  assertTextSize,
  MAX_PROJECT_BYTES,
  MAX_SELECTED_TOOLS,
  processingError,
} from "./limits";
import type {
  ProcessingRequest,
  ProcessingMessage,
  PreparedImport,
} from "./types";

const progress = (stage: string) =>
  self.postMessage({ type: "progress", stage } satisfies ProcessingMessage);

self.onmessage = async ({ data }: MessageEvent<ProcessingRequest>) => {
  try {
    let result: unknown;
    if (data.action === "parse") {
      progress("Reading specification…");
      if (data.file) assertSpecFile(data.file);
      const text = data.file ? await data.file.text() : data.content || "";
      assertTextSize(text);
      progress("Parsing and resolving local references…");
      const {
        parseOpenAPIFromContent,
        buildValidationSummary,
        buildEndpointWarnings,
      } = await import("../parsers/openapi");
      const spec = await parseOpenAPIFromContent(text, data.filename);
      // Raw imports are unnecessary after normalization and amplify storage substantially.
      for (const operation of spec.apiModel!.operations) {
        if (operation.source) delete operation.source.raw;
        for (const parameter of operation.parameters)
          if (parameter.source) delete parameter.source.raw;
      }
      progress("Checking tools and supported features…");
      const { analyzeCapabilities } = await import("../capabilities");
      const { createToolConfig } = await import("../project-tools");
      const capabilities = analyzeCapabilities(spec.apiModel!);
      const recommended = new Set(
        capabilities.operations
          .filter((item) => item.recommended)
          .slice(0, MAX_SELECTED_TOOLS)
          .map((item) => item.operationId),
      );
      result = {
        spec,
        capabilities,
        tools: spec.endpoints.map((endpoint) => ({
          ...createToolConfig(endpoint),
          enabled: recommended.has(endpoint.id),
        })),
        summary: buildValidationSummary(spec),
        warnings: [...buildEndpointWarnings(spec)],
      } satisfies PreparedImport;
    } else if (
      data.action === "project-import" ||
      data.action === "project-validate"
    ) {
      progress("Checking project file…");
      const { parseProjectFile, validateProjectFile } =
        await import("../../store/project-file");
      if (data.action === "project-import") {
        if (data.file) assertSpecFile(data.file, true);
        result = parseProjectFile(
          data.file ? await data.file.text() : data.content || "",
        );
      } else result = validateProjectFile(data.project);
    } else if (data.action === "project-export") {
      progress("Preparing project file…");
      const { serializeProjectFile } = await import("../../store/project-file");
      result = serializeProjectFile(data.project);
      assertTextSize(result as string, MAX_PROJECT_BYTES);
    } else if (data.action === "capabilities") {
      progress("Checking supported features…");
      assertGraphBudget(data.spec);
      const { analyzeCapabilities } = await import("../capabilities");
      const { buildEndpointWarnings } = await import("../parsers/validation");
      result = {
        capabilities: analyzeCapabilities(data.spec.apiModel!),
        warnings: [...buildEndpointWarnings(data.spec)],
      } satisfies import("./types").PreparedAnalysis;
    } else if (data.action === "export-analysis") {
      progress("Checking export and trust scan…");
      assertGraphBudget(data.payload);
      const { buildGenerationPlan } = await import("../generator/normalize");
      const { buildToolPlans } = await import("../generator/planner");
      const { projectToolsToScanTools } =
        await import("../scanner/from-project");
      const { scanTools } = await import("../scanner");
      const payload =
        data.payload as import("../generator/types").GeneratorRequest;
      const plan = buildGenerationPlan(payload);
      const trustTools = projectToolsToScanTools(
        payload.spec.apiModel,
        payload.tools as import("../../store/project-store").ToolConfig[],
      );
      const selected = new Map(
        payload.tools.map((tool) => [tool.endpointId, tool.toolName]),
      );
      const manualReview = buildToolPlans(payload.spec.apiModel!)
        .filter((tool) => selected.has(tool.id))
        .map((tool) => ({
          id: tool.id,
          label: `${tool.method} ${tool.path}`,
          toolName: selected.get(tool.id)!,
          reasons: [
            ...tool.manualReview.map((flag) => flag.message),
            ...tool.warnings,
            ...(tool.authStrategy.source === "unsupported"
              ? ["Unsupported authentication requirements need manual review."]
              : []),
          ],
        }))
        .filter((tool) => tool.reasons.length > 0);
      result = {
        plan,
        trustTools,
        report: scanTools(trustTools),
        manualReview,
      } satisfies import("./types").ExportAnalysis;
    } else {
      assertGraphBudget(data.payload);
      progress(
        data.action === "preview"
          ? "Generating preview…"
          : "Generating and packing your server…",
      );
      const { generateProjectInBrowser, previewProjectInBrowser } =
        await import("../client-generate");
      if (data.action === "preview")
        result = previewProjectInBrowser(data.payload);
      else {
        const generated = await generateProjectInBrowser(data.payload);
        // Blob storage is shared across threads; do not clone the full generated file map into the UI.
        result = { blob: generated.blob, filename: generated.filename };
      }
    }
    self.postMessage({ type: "success", result } satisfies ProcessingMessage);
  } catch (error) {
    self.postMessage({
      type: "error",
      error: processingError(error),
    } satisfies ProcessingMessage);
  }
};
