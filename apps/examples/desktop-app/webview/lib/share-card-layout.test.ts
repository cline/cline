import { describe, expect, it } from "vitest";
import {
	buildShareCardModel,
	type ShareCardInput,
	type ShareCardToggles,
} from "./share-card";
import {
	type Box,
	fitText,
	type GlyphMetrics,
	type MeasureText,
	planRegions,
	planShareCard,
	SHARE_CARD_HEIGHT,
	SHARE_CARD_WIDTH,
	type TextOp,
} from "./share-card-layout";

/**
 * Deliberately pessimistic metrics: wider than any real UI font and with
 * descenders on every string, so a plan that fits here fits on screen.
 */
const pessimistic: MeasureText = (text, weight, size): GlyphMetrics => ({
	left: 0,
	right: text.length * size * (weight >= 600 ? 0.64 : 0.58),
	ascent: size * 0.76,
	descent: size * 0.22,
	emAscent: size * 0.8,
	emDescent: size * 0.2,
});

function overlaps(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width - 0.5 &&
		b.x < a.x + a.width - 0.5 &&
		a.y < b.y + b.height - 0.5 &&
		b.y < a.y + a.height - 0.5
	);
}

function inside(outer: Box, inner: Box): boolean {
	return (
		inner.x >= outer.x - 0.5 &&
		inner.y >= outer.y - 0.5 &&
		inner.x + inner.width <= outer.x + outer.width + 0.5 &&
		inner.y + inner.height <= outer.y + outer.height + 0.5
	);
}

const CANVAS: Box = {
	x: 0,
	y: 0,
	width: SHARE_CARD_WIDTH,
	height: SHARE_CARD_HEIGHT,
};

function input(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
	return {
		rangeDays: 30,
		startedSessions: 432,
		subagentRuns: 2431,
		activeDays: 28,
		longestStreakDays: 14,
		peakHour: 13,
		nightShare: 0.3,
		rhythmCounts: Array.from({ length: 7 }, (_, d) =>
			Array.from({ length: 24 }, (_, h) => (d + h) % 5),
		),
		agents: [
			{ id: "codex", startedSessions: 371, subagentRuns: 1012 },
			{ id: "claude-code", startedSessions: 25, subagentRuns: 1413 },
			{ id: "cline", startedSessions: 36, subagentRuns: 6 },
		],
		...overrides,
	};
}

const EXTREME = input({
	rangeDays: 90,
	startedSessions: 987_654_321,
	subagentRuns: 123_456_789_012,
	activeDays: 90,
	longestStreakDays: 90,
	agents: input().agents.map((agent) => ({
		...agent,
		startedSessions: 999_999_999,
		subagentRuns: 999_999_999_999,
	})),
});

const CONTENTS: Array<[string, ShareCardInput]> = [
	["typical", input()],
	[
		"empty",
		input({
			startedSessions: 0,
			subagentRuns: 0,
			activeDays: 0,
			longestStreakDays: 0,
			peakHour: null,
			nightShare: 0,
			agents: input().agents.map((a) => ({
				...a,
				startedSessions: 0,
				subagentRuns: 0,
			})),
		}),
	],
	[
		"one agent",
		input({ agents: [{ id: "cline", startedSessions: 7, subagentRuns: 0 }] }),
	],
	["two agents", input({ agents: input().agents.slice(0, 2) })],
	["extreme numbers", EXTREME],
];

const TOGGLES: ShareCardToggles[] = [];
for (const includeRhythm of [true, false]) {
	for (const includeAgents of [true, false]) {
		for (const includeStreaks of [true, false]) {
			TOGGLES.push({ includeRhythm, includeAgents, includeStreaks });
		}
	}
}

const CASES = CONTENTS.flatMap(([name, content]) =>
	TOGGLES.map((toggles) => ({ name, content, toggles })),
);

describe("planShareCard", () => {
	it.each(
		CASES,
	)("keeps every glyph in its slot and nothing overlapping ($name, $toggles)", ({
		content,
		toggles,
	}) => {
		const plan = planShareCard(buildShareCardModel(content, toggles));
		const placed: Array<{ id: string; group: string; box: Box }> = [];

		for (const op of plan.ops) {
			if (op.kind === "text") {
				const fitted = fitText(op, pessimistic);
				expect(
					inside(op.slot, fitted.bounds),
					`${op.id} escapes its slot`,
				).toBe(true);
				expect(
					fitted.size,
					`${op.id} fell below its floor`,
				).toBeGreaterThanOrEqual(op.minSize);
				placed.push({ id: op.id, group: op.id, box: op.slot });
			} else {
				placed.push({
					id: op.id,
					group: op.kind === "rect" ? op.group : op.id,
					box: op.box,
				});
			}
		}

		for (const entry of placed) {
			expect(inside(CANVAS, entry.box), `${entry.id} leaves the canvas`).toBe(
				true,
			);
		}
		for (let i = 0; i < placed.length; i += 1) {
			for (let j = i + 1; j < placed.length; j += 1) {
				const a = placed[i] as (typeof placed)[number];
				const b = placed[j] as (typeof placed)[number];
				if (a.group === b.group) continue;
				expect(overlaps(a.box, b.box), `${a.id} overlaps ${b.id}`).toBe(false);
			}
		}
	});

	it("gives every agent a column instead of dropping one", () => {
		const plan = planShareCard(
			buildShareCardModel(input(), {
				includeRhythm: true,
				includeAgents: true,
				includeStreaks: true,
			}),
		);
		const names = plan.ops.flatMap((op) =>
			op.kind === "text" && /^agent\d\.name$/.test(op.id) ? [op.text] : [],
		);
		expect(names).toEqual(["Codex", "Cline", "Claude Code"]);
	});

	it("titles the card as a usage profile", () => {
		const plan = planShareCard(
			buildShareCardModel(input(), {
				includeRhythm: true,
				includeAgents: true,
				includeStreaks: true,
			}),
		);
		const title = plan.ops.find((op) => op.id === "title");
		expect(title?.kind === "text" && title.text).toBe("Usage profile");
	});
});

describe("planRegions", () => {
	it.each([
		"rhythm+agents",
		"rhythm",
		"agents",
		"minimal",
	] as const)("stacks the %s template inside the content box without gaps wider than its spacing", (variant) => {
		const regions = Object.values(planRegions(variant)).sort(
			(a, b) => a.y - b.y,
		);
		let previousBottom = 44;
		for (const region of regions) {
			expect(region.y).toBeGreaterThanOrEqual(previousBottom);
			// No dead band: leftover height is spread over the gaps, never pooled.
			expect(region.y - previousBottom).toBeLessThanOrEqual(80);
			previousBottom = region.y + region.height;
		}
		expect(previousBottom).toBeLessThanOrEqual(SHARE_CARD_HEIGHT - 36 + 1);
	});
});

describe("fitText", () => {
	const slot: Box = { x: 100, y: 50, width: 200, height: 30 };
	const op = (text: string, align: "left" | "right" = "left"): TextOp => ({
		kind: "text",
		id: "sample",
		text,
		slot,
		weight: 400,
		maxSize: 24,
		minSize: 12,
		color: "primary",
		align,
	});

	it("keeps the largest size that fits", () => {
		const fitted = fitText(op("Short"), pessimistic);
		expect(fitted.size).toBe(24);
		expect(fitted.truncated).toBe(false);
	});

	it("shrinks before it truncates, then ellipsizes at the floor", () => {
		const shrunk = fitText(op("A somewhat longer line"), pessimistic);
		expect(shrunk.size).toBeLessThan(24);
		expect(shrunk.truncated).toBe(false);

		const truncated = fitText(op("x".repeat(200)), pessimistic);
		expect(truncated.size).toBe(12);
		expect(truncated.truncated).toBe(true);
		expect(truncated.text.endsWith("…")).toBe(true);
		expect(inside(slot, truncated.bounds)).toBe(true);
	});

	it("aligns right-aligned text to the slot's right edge", () => {
		const fitted = fitText(op("Last 30 days", "right"), pessimistic);
		expect(fitted.bounds.x + fitted.bounds.width).toBeCloseTo(
			slot.x + slot.width,
		);
	});
});
