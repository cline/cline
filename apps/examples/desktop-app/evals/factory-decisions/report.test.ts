import { describe, expect, test } from "bun:test";
import type { ScoperTrial } from "./grade";
import {
	formatMarkdown,
	formatTable,
	overallPassRate,
	summarize,
	wilson,
} from "./report";

const trial = (
	outcome: ScoperTrial["outcome"],
	totalCost?: number,
): ScoperTrial => ({
	suite: "scoper",
	scenarioId: "s",
	trial: 1,
	outcome,
	seconds: 10,
	modelRequests: 1,
	designerRuns: 1,
	formatRetries: 0,
	toolCalls: {},
	...(totalCost === undefined
		? {}
		: {
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost,
				},
			}),
});

describe("wilson", () => {
	test("matches the textbook interval and stays within 0-1", () => {
		const [low, high] = wilson(3, 3);
		expect(low).toBeCloseTo(0.4385, 3);
		expect(high).toBe(1);
		const [zeroLow, zeroHigh] = wilson(0, 10);
		expect(zeroLow).toBe(0);
		expect(zeroHigh).toBeCloseTo(0.2775, 3);
		expect(wilson(0, 0)).toEqual([0, 1]);
	});
});

describe("summarize", () => {
	test("rates graded trials, measures consistency without harness outcomes, sums cost", () => {
		const summary = summarize({
			suite: "scoper",
			id: "s",
			expect: "plan",
			trials: [
				trial("plan", 0.01),
				trial("plan", 0.02),
				trial("split"),
				trial("aborted"),
			],
			grades: [
				{ pass: true, reasons: [] },
				{ pass: true, reasons: [] },
				{ pass: false, reasons: ["expected plan, got split"] },
				undefined,
			],
		});
		expect(summary).toMatchObject({
			trials: 4,
			graded: 3,
			passes: 2,
			outcomes: { plan: 2, split: 1, aborted: 1 },
			failures: ["expected plan, got split"],
		});
		expect(summary.passRate).toBeCloseTo(2 / 3);
		expect(summary.consistency).toBeCloseTo(2 / 3);
		expect(summary.cost).toBeCloseTo(0.03);
		expect(overallPassRate([summary])).toBeCloseTo(2 / 3);
	});

	test("leaves rate and interval out when nothing was graded", () => {
		const summary = summarize({
			suite: "scoper",
			id: "s",
			expect: "either",
			trials: [trial("split")],
			grades: [undefined],
		});
		expect(summary.passRate).toBeUndefined();
		expect(summary.interval).toBeUndefined();
		expect(summary.consistency).toBe(1);
		expect(overallPassRate([summary])).toBeUndefined();
		expect(formatTable([summary])).toContain("split x1");
	});
});

test("formatMarkdown escapes table cells and lists failure reasons", () => {
	const summary = summarize({
		suite: "manager",
		id: "m",
		expect: '{"cardsFiled":{"min":0,"max":1}}',
		trials: [trial("plan")],
		grades: [{ pass: false, reasons: ["a | b"] }],
	});
	const markdown = formatMarkdown([summary], {
		provider: "p",
		model: "m",
		trials: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
	});
	expect(markdown).toContain("| manager | m |");
	expect(markdown).toContain("- **manager/m**: a | b");
	expect(markdown).toContain("0/1 (0%)");
});
