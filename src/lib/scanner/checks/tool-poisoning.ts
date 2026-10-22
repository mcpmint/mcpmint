import type { Finding, ScanTool } from "../types.ts";

const PROMPT_OVERRIDE = /\b(?:ignore|disregard|override|replace)\b.{0,50}\b(?:previous|system|developer|user|safety)\b.{0,30}\b(?:instructions?|prompt|message|rules?)\b/i;
const CONCEAL_ACTION = /\b(?:do not|don't|never)\s+(?:tell|show|mention|reveal|inform)\b.{0,50}\b(?:user|operator|human)\b/i;
const FORCED_ACTION = /\b(?:always|must|immediately)\s+(?:call|invoke|execute|send|upload|forward|exfiltrate)\b/i;
const UNTRUSTED_INSTRUCTIONS = /\b(?:follow|obey|execute)\b.{0,40}\b(?:instructions?|commands?)\b.{0,50}\b(?:response|webpage|document|content|result)\b/i;

interface PoisonSignal {
    pattern: RegExp;
    evidence: string;
    explanation: string;
}

const SIGNALS: PoisonSignal[] = [
    {
        pattern: PROMPT_OVERRIDE,
        evidence: "prompt-override language",
        explanation: "The description attempts to override higher-priority instructions or the user's intent.",
    },
    {
        pattern: CONCEAL_ACTION,
        evidence: "concealment instruction",
        explanation: "The description asks the model to hide behavior from the person using the tool.",
    },
    {
        pattern: FORCED_ACTION,
        evidence: "forced follow-up action",
        explanation: "The description mandates an unrelated follow-up action instead of describing the tool's capability.",
    },
    {
        pattern: UNTRUSTED_INSTRUCTIONS,
        evidence: "instructions delegated to untrusted content",
        explanation: "The description tells the model to execute instructions found in untrusted tool output or external content.",
    },
];

export function checkToolPoisoning(tools: ScanTool[]): Finding[] {
    const findings: Finding[] = [];
    for (const tool of tools) {
        const texts = [["description", tool.description], ["title", tool.title]] as const;
        for (const [field, text] of texts) for (const signal of SIGNALS) {
            const match = text?.match(signal.pattern);
            if (!match) continue;
            findings.push({
                check: "TOOL_POISONING",
                severity: "red",
                toolName: tool.name,
                message: `${signal.evidence} in ${field} of "${tool.name}"`,
                explanation: signal.explanation,
                remediation: "Delete the instruction-like language and describe only the tool's inputs, side effects, and returned data. Treat remote content as data, never as instructions.",
                evidence: match[0].slice(0, 160),
            });
        }
    }
    return findings;
}
