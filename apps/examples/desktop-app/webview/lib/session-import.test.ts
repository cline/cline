import { describe, expect, it } from "vitest";
import {
	readImportedFromTool,
	readImportedHistorySummaryActivity,
} from "./session-import";

describe("readImportedFromTool", () => {
	it("reads a known tool off the importedFrom marker", () => {
		expect(
			readImportedFromTool({ importedFrom: { tool: "codex", sourceId: "x" } }),
		).toBe("codex");
	});

	it("ignores missing, malformed, or unknown markers", () => {
		expect(readImportedFromTool(undefined)).toBeUndefined();
		expect(readImportedFromTool({ title: "native" })).toBeUndefined();
		expect(readImportedFromTool({ importedFrom: "codex" })).toBeUndefined();
		expect(
			readImportedFromTool({ importedFrom: { tool: "cursor" } }),
		).toBeUndefined();
	});
});

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
