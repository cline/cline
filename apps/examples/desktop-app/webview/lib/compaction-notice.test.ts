import { describe, expect, it } from "vitest";
import { describeImportedHistorySummaryNotice } from "./compaction-notice";

describe("describeImportedHistorySummaryNotice", () => {
	it("tracks one row from started to completed for an imported summary", () => {
		const started = describeImportedHistorySummaryNotice({
			kind: "manual_compaction",
			phase: "started",
			iteration: 1,
			importedFrom: "claude-code",
		});
		const completed = describeImportedHistorySummaryNotice({
			kind: "manual_compaction",
			phase: "completed",
			iteration: 1,
			importedFrom: "claude-code",
			messagesBefore: 9,
			messagesAfter: 2,
		});
		expect(started?.content).toContain("Summarizing the imported Claude Code");
		expect(completed?.content).toBe(
			"Summarized the imported Claude Code history · 9 → 2 messages",
		);
		expect(completed?.key).toBe(started?.key);
	});

	it("ignores compactions that are not imported-history summaries", () => {
		expect(
			describeImportedHistorySummaryNotice({
				kind: "auto_compaction",
				phase: "started",
				iteration: 3,
			}),
		).toBeUndefined();
		expect(describeImportedHistorySummaryNotice(undefined)).toBeUndefined();
	});
});
