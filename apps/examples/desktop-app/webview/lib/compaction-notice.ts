import {
	SESSION_IMPORT_TOOL_LABELS,
	type SessionImportTool,
} from "./session-import";

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Transcript status row for the compaction core runs when an imported session
 * is first resumed (core tags those notices with `importedFrom`). The started
 * and completed notices share a key so the row updates in place. Other
 * compaction notices return undefined and stay out of the transcript.
 */
export function describeImportedHistorySummaryNotice(
	metadata: unknown,
): { key: string; content: string } | undefined {
	if (!metadata || typeof metadata !== "object") return undefined;
	const record = metadata as Record<string, unknown>;
	const tool =
		typeof record.importedFrom === "string"
			? SESSION_IMPORT_TOOL_LABELS[record.importedFrom as SessionImportTool]
			: undefined;
	if (!tool) return undefined;
	const key = `imported_summary_${asFiniteNumber(record.iteration) ?? 0}`;
	switch (record.phase) {
		case "started":
			return {
				key,
				content: `Summarizing the imported ${tool} history so the model continues from a recap rather than the original tool calls...`,
			};
		case "completed": {
			const before = asFiniteNumber(record.messagesBefore);
			const after = asFiniteNumber(record.messagesAfter);
			return {
				key,
				content:
					before !== undefined && after !== undefined
						? `Summarized the imported ${tool} history · ${before} → ${after} messages`
						: `Summarized the imported ${tool} history`,
			};
		}
		case "skipped":
			return {
				key,
				content: `Could not summarize the imported ${tool} history; continuing with the full transcript.`,
			};
		default:
			return undefined;
	}
}
