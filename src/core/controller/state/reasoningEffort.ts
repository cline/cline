import { OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import { OpenaiReasoningEffort } from "@/shared/storage/types"

export function normalizeOpenaiReasoningEffort(
	effort: ProtoOpenaiReasoningEffort | OpenaiReasoningEffort | string,
): OpenaiReasoningEffort {
	if (typeof effort === "string") {
		if (effort === "none" || effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
			return effort
		}
		return "medium"
	}

	switch (effort) {
		case ProtoOpenaiReasoningEffort.LOW:
			return "low"
		case ProtoOpenaiReasoningEffort.MEDIUM:
			return "medium"
		case ProtoOpenaiReasoningEffort.HIGH:
			return "high"
		default:
			return "medium"
	}
}
