import type { ProviderSettings } from "@cline/core";
import type { CliReasoningEffort } from "./types";

type ActiveCliReasoningEffort = Exclude<CliReasoningEffort, "none">;

const ACTIVE_REASONING_EFFORTS = new Set<ActiveCliReasoningEffort>([
	"low",
	"medium",
	"high",
	"xhigh",
]);

export interface ResolveCliReasoningInput {
	thinking: boolean;
	thinkingExplicitlySet?: boolean;
	reasoningEffort?: CliReasoningEffort;
	persistedReasoning?: ProviderSettings["reasoning"];
}

export interface ResolvedCliReasoning {
	thinking?: boolean;
	reasoningEffort?: ActiveCliReasoningEffort;
}

function isActiveReasoningEffort(
	effort: unknown,
): effort is ActiveCliReasoningEffort {
	return (
		typeof effort === "string" &&
		ACTIVE_REASONING_EFFORTS.has(effort as ActiveCliReasoningEffort)
	);
}

export function resolveCliReasoning({
	thinking,
	thinkingExplicitlySet,
	reasoningEffort,
	persistedReasoning,
}: ResolveCliReasoningInput): ResolvedCliReasoning {
	if (thinkingExplicitlySet) {
		return {
			thinking,
			reasoningEffort: isActiveReasoningEffort(reasoningEffort)
				? reasoningEffort
				: undefined,
		};
	}

	if (
		persistedReasoning?.enabled === false ||
		persistedReasoning?.effort === "none"
	) {
		return { thinking: false, reasoningEffort: undefined };
	}

	if (isActiveReasoningEffort(persistedReasoning?.effort)) {
		return { thinking: true, reasoningEffort: persistedReasoning.effort };
	}

	if (persistedReasoning?.enabled === true) {
		return { thinking: true, reasoningEffort: "medium" };
	}

	return { thinking: undefined, reasoningEffort: undefined };
}
