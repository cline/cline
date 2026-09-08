import { describe, expect, it } from "vitest";
import { readImportedHistorySummaryActivity } from "./compaction-notice";

describe("readImportedHistorySummaryActivity", () => {
	it("labels the started notice and clears on completion", () => {
		expect(
			readImportedHistorySummaryActivity({
				kind: "manual_compaction",
				phase: "started",
				importedFrom: "claude-code",
			}),
		).toEqual({
			phase: "started",
			label: "Summarizing the imported Claude Code history...",
		});
		expect(
			readImportedHistorySummaryActivity({
				kind: "manual_compaction",
				phase: "completed",
				importedFrom: "claude-code",
			}),
		).toEqual({ phase: "finished" });
	});

	it("ignores compactions that are not imported-history summaries", () => {
		expect(
			readImportedHistorySummaryActivity({
				kind: "auto_compaction",
				phase: "started",
			}),
		).toBeUndefined();
		expect(readImportedHistorySummaryActivity(undefined)).toBeUndefined();
	});
});
