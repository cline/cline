import { OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import {
	isOpenaiReasoningEffort,
	normalizeOpenaiReasoningEffort as normalizeOpenaiReasoningEffortString,
	OpenaiReasoningEffort,
} from "@/shared/storage/types"

export function normalizeOpenaiReasoningEffort(
	effort: ProtoOpenaiReasoningEffort | OpenaiReasoningEffort | string,
): OpenaiReasoningEffort {
	if (isOpenaiReasoningEffort(effort)) {
		return effort
	}

	if (typeof effort === "string") {
		return normalizeOpenaiReasoningEffortString(effort)
	}

	switch (effort) {
		case ProtoOpenaiReasoningEffort.LOW:
			return "low"
		case ProtoOpenaiReasoningEffort.MEDIUM:
			return "medium"
		case ProtoOpenaiReasoningEffort.HIGH:
			return "high"
		default:
			return normalizeOpenaiReasoningEffortString()
	}
}
