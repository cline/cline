import type { CheckpointEntry } from "@cline/core";
import { getUserRunSpan } from "@cline/core";
import type { Message } from "@cline/shared";
import { formatDisplayUserInput, truncateStr } from "@cline/shared";
import type { CheckpointPickerItem } from "./components/dialogs/checkpoint-picker";

/** Highest checkpoint recorded at or before `runCount`. */
function checkpointForRun(
	checkpointHistory: readonly CheckpointEntry[],
	runCount: number,
): CheckpointEntry | undefined {
	return checkpointHistory.reduce<CheckpointEntry | undefined>(
		(best, checkpoint) => {
			if (checkpoint.runCount > runCount) {
				return best;
			}
			if (!best || checkpoint.runCount > best.runCount) {
				return checkpoint;
			}
			return best;
		},
		undefined,
	);
}

function extractText(content: Message["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter(
			(b): b is { type: "text"; text: string } =>
				typeof b === "object" &&
				b !== null &&
				"type" in b &&
				(b as { type?: unknown }).type === "text" &&
				"text" in b &&
				typeof (b as { text?: unknown }).text === "string",
		)
		.map((b) => b.text)
		.join(" ");
}

/**
 * Builds the `/undo` checkpoint picker rows from the raw conversation and the
 * recorded checkpoint history.
 *
 * The run count MUST advance with `getUserRunSpan`, exactly as the core does
 * when it numbers checkpoints and later resolves them. Tool-result messages
 * carry role "user" but contribute 0, and a compaction summary spans the turns
 * it folded. Counting raw "user" messages overcounts, so the picker would hand
 * restore a run number the core cannot map — surfacing as
 * "Could not find user message for run N" and aborting the restore.
 */
export function buildCheckpointPickerItems(
	rawMessages: readonly Message[],
	checkpointHistory: readonly CheckpointEntry[],
): CheckpointPickerItem[] {
	const items: CheckpointPickerItem[] = [];
	let userRunCount = 0;
	for (const msg of rawMessages) {
		const span = getUserRunSpan(msg);
		if (span < 1) {
			continue;
		}
		userRunCount += span;
		const checkpoint = checkpointForRun(checkpointHistory, userRunCount);
		if (!checkpoint) {
			continue;
		}
		const text = extractText(msg.content);
		const preview = truncateStr(
			formatDisplayUserInput(text).replace(/\s+/g, " "),
			60,
		);
		if (!preview) {
			continue;
		}
		items.push({
			runCount: userRunCount,
			text: preview,
			fullText: text,
			createdAt: checkpoint.createdAt,
		});
	}
	return items;
}
