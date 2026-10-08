import type { GenerationPlan } from "../generator/types.ts";
import type { ScanTool } from "./types.ts";

/** The exact normalized metadata used by both web and CLI exports. */
export function generationPlanToScanTools(plan: GenerationPlan): ScanTool[] {
    return plan.tools.map((tool) => ({
        name: tool.functionName,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        annotations: tool.annotations,
        inputSchema: {
            type: "object",
            properties: Object.fromEntries(tool.params.map((parameter) => [parameter.argName, {
                ...(parameter.schema || { type: parameter.type }),
                description: parameter.description || undefined,
            }])),
            required: tool.params.filter((parameter) => parameter.required).map((parameter) => parameter.argName),
        },
    }));
}
