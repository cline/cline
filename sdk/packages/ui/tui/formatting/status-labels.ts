import type { AgentEvent } from "@cline/shared";

/**
 * Label for a status notice already known not to be a compaction notice.
 * Callers that have parsed the compaction metadata themselves use this to
 * avoid re-parsing.
 */
export function resolveNonCompactionStatusLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice" || event.displayRole !== "status") {
		return undefined;
	}
	switch (event.reason) {
		case "auto_compaction":
			return "auto-compacting";
		case "manual_compaction":
			return "compacting";
		case "compaction_budget_emergency":
			return "context budget adjusted";
	}
	return event.message.trim() || undefined;
}
