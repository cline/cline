import { describe, expect, it } from "vitest";
import {
	countLetMe,
	inspectAssistantTextLoop,
	normalizeLoopLine,
	trailingRepeatedLineRun,
	trailingSameTokenRun,
} from "./text-loop-detection";

describe("text-loop-detection", () => {
	it("normalizes lines for comparison", () => {
		expect(normalizeLoopLine("  Let me update the themepack.  ")).toBe(
			"let me update the themepack",
		);
	});

	it("counts let-me phrases", () => {
		const text = "Let me check.\nLet me inspect.\nOkay let me look now.";
		expect(countLetMe(text)).toBe(3);
	});

	it("detects trailing repeated intent lines as hard", () => {
		const line =
			"Let me check the Cline settings and logs now for the tool calling issue.";
		const text = Array.from({ length: 30 }, () => line).join("\n");
		const verdict = inspectAssistantTextLoop(text);
		expect(verdict.kind).toBe("hard");
		expect(verdict.letMeCount).toBeGreaterThanOrEqual(24);
		expect(trailingRepeatedLineRun(text).count).toBeGreaterThanOrEqual(16);
	});

	it("detects Read. token spam as hard", () => {
		const text = Array.from({ length: 50 }, () => "Read.").join("\n");
		const verdict = inspectAssistantTextLoop(text);
		expect(verdict.kind).toBe("hard");
		expect(trailingSameTokenRun(text).count).toBeGreaterThanOrEqual(40);
	});

	it("allows normal assistant prose", () => {
		const text = [
			"Batch is queued. Next I will validate the CSV and update the graph.",
			"Validation passed for all 8 candidates.",
			"Graph update completed with AST-only refresh.",
			"Ready for your submit decision.",
		].join("\n");
		expect(inspectAssistantTextLoop(text).kind).toBe("ok");
	});

	it("soft-flags moderate let-me density before hard threshold", () => {
		const lines = Array.from(
			{ length: 14 },
			(_, i) => `Let me verify step ${i} of the pipeline status now.`,
		);
		const text = lines.join("\n");
		const verdict = inspectAssistantTextLoop(text, {
			minCharsForHard: 50_000,
		});
		expect(verdict.kind).toBe("soft");
	});
});
