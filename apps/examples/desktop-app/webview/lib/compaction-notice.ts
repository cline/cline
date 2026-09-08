import {
	SESSION_IMPORT_TOOL_LABELS,
	type SessionImportTool,
} from "./session-import";

export type ImportedHistorySummaryActivity =
	| { phase: "started"; label: string }
	| { phase: "finished" };

/**
 * Reads the compaction status notice core emits when an imported session's
 * history is summarized on its first resumed turn (core tags those notices
 * with `importedFrom`). The label replaces the generic "Thinking..." indicator
 * while the summary runs; `finished` clears it. Other notices return
 * undefined.
 */
export function readImportedHistorySummaryActivity(
	metadata: unknown,
): ImportedHistorySummaryActivity | undefined {
	if (!metadata || typeof metadata !== "object") return undefined;
	const record = metadata as Record<string, unknown>;
	const tool =
		typeof record.importedFrom === "string"
			? SESSION_IMPORT_TOOL_LABELS[record.importedFrom as SessionImportTool]
			: undefined;
	if (!tool) return undefined;
	switch (record.phase) {
		case "started":
			return {
				phase: "started",
				label: `Summarizing the imported ${tool} history...`,
			};
		case "completed":
		case "skipped":
			return { phase: "finished" };
		default:
			return undefined;
	}
}
