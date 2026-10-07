import type { ApiModel } from "@/lib/api-model";
import type { GeneratorToolConfig } from "../generator/types.ts";
import { buildGenerationPlan } from "../generator/normalize.ts";
import { generationPlanToScanTools } from "./from-plan.ts";

export function projectToolsToScanTools(apiModel: ApiModel | undefined, tools: GeneratorToolConfig[]) {
    if (!apiModel) throw new Error("Import a canonical API model before scanning.");
    return generationPlanToScanTools(buildGenerationPlan({
        spec: { info: apiModel.info, baseUrl: apiModel.baseUrls[0] || "", apiModel },
        tools,
        serverConfig: { name: "scan", version: "1", host: "localhost", port: 8080, transport: "stdio" },
        authConfig: { type: "none" },
        exportConfig: { language: "node", framework: "mcp-ts-sdk", packageManager: "npm" },
    }));
}
