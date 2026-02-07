export const OPENAI_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh"] as const

export type OpenaiReasoningEffort = (typeof OPENAI_REASONING_EFFORT_OPTIONS)[number]

export function isOpenaiReasoningEffort(value: unknown): value is OpenaiReasoningEffort {
	return typeof value === "string" && OPENAI_REASONING_EFFORT_OPTIONS.includes(value as OpenaiReasoningEffort)
}

export type Mode = "plan" | "act"
