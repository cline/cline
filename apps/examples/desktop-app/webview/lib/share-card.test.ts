import { describe, expect, it } from "vitest";
import {
	buildShareCardModel,
	defaultShareCardToggles,
	formatCount,
	quantizeRhythm,
	renderShareCard,
	SHARE_CARD_DISCLOSURE,
	SHARE_CARD_TITLE,
	shareCardFileName,
	shareCardInputFromReport,
} from "./share-card";
import { planShareCard } from "./share-card-layout";
import type {
	SourcePatterns,
	UsagePatternsReport,
	UsageSourceId,
} from "./usage-types";

const ALL_ON = {
	includeRhythm: true,
	includeAgents: true,
	includeStreaks: true,
};

function matrix(fill: (weekday: number, hour: number) => number): number[][] {
	return Array.from({ length: 7 }, (_, weekday) =>
		Array.from({ length: 24 }, (_, hour) => fill(weekday, hour)),
	);
}

function source(
	id: UsageSourceId,
	options: { installed?: boolean; roots?: number; subagents?: number } = {},
): SourcePatterns {
	const roots = options.roots ?? 0;
	const subagents = options.subagents ?? 0;
	return {
		availability: {
			source: id,
			installed: options.installed ?? true,
			root: "/Users/private-user/.store",
			note: "private note",
			coverage: {
				scanned: roots + subagents,
				recognized: roots + subagents,
				skipped: { "private reason": 1 },
				oldestSessionMs: 1_700_000_000_000,
			},
		},
		rhythm: {
			hourHistogram: Array.from({ length: 24 }, () => 0),
			weekdayHourMatrix: matrix(() => 0),
			daily: [{ date: "2026-03-02", started: roots }],
			activeDays: 1,
			firstActiveMs: 1_700_000_000_000,
			currentStreakDays: 1,
			longestStreakDays: 1,
			peakHour: 9,
			nightShare: 0,
		},
		workflow: {
			sessions: roots + subagents,
			rootSessions: roots,
			subagentSessions: subagents,
			orchestrationShare: 0,
			maxDepth: 0,
			depthHistogram: {},
		},
		projects: [
			{
				project: "GitHub/secret-client-acquisition",
				sessions: roots + subagents,
				activeDays: 1,
				lastActiveMs: 1_700_000_000_000,
				subagentSessions: subagents,
			},
		],
		span: {
			buckets: {
				under10m: roots,
				under1h: 0,
				under4h: 0,
				under24h: 0,
				over24h: 0,
			},
		},
		lifecycle: { terminalSessions: 0, failedSessions: 0 },
	};
}

function report(
	overrides: Partial<UsagePatternsReport> = {},
): UsagePatternsReport {
	return {
		generatedAtMs: 1_700_000_000_000,
		scanMs: 12,
		rangeDays: 30,
		sources: [
			source("codex", { roots: 371, subagents: 1012 }),
			source("claude-code", { roots: 25, subagents: 1413 }),
			source("cline", { roots: 36, subagents: 6 }),
		],
		combined: {
			rhythm: {
				hourHistogram: Array.from({ length: 24 }, () => 0),
				weekdayHourMatrix: matrix((weekday, hour) =>
					hour >= 9 && hour < 18 && weekday < 5 ? 3 : 0,
				),
				daily: [{ date: "2026-03-02", started: 432 }],
				activeDays: 28,
				firstActiveMs: 1_700_000_000_000,
				currentStreakDays: 4,
				longestStreakDays: 14,
				peakHour: 13,
				nightShare: 0.04,
			},
			workflow: {
				sessions: 2863,
				rootSessions: 432,
				subagentSessions: 2431,
				orchestrationShare: 2431 / 2863,
				maxDepth: 2,
				depthHistogram: { "1": 10 },
			},
			projects: [
				{
					project: "GitHub/secret-client-acquisition",
					sessions: 2863,
					activeDays: 28,
					lastActiveMs: 1_700_000_000_000,
					subagentSessions: 2431,
				},
			],
			lifecycle: { terminalSessions: 3, failedSessions: 1 },
		},
		...overrides,
	};
}

/** Replaces every string in a report — values and record keys — with a unique canary. */
function withCanaries(
	value: unknown,
	path: string,
	keepSourceIds: boolean,
): unknown {
	if (typeof value === "string") {
		if (keepSourceIds && path.endsWith(".availability.source")) return value;
		return `CANARY:${path}`;
	}
	if (Array.isArray(value)) {
		return value.map((item, index) =>
			withCanaries(item, `${path}[${index}]`, keepSourceIds),
		);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries([
			...Object.entries(value).map(([key, item]) => [
				key,
				withCanaries(item, `${path}.${key}`, keepSourceIds),
			]),
			[`CANARY-KEY:${path}`, 1],
		]);
	}
	return value;
}

describe("share card privacy", () => {
	it.each([
		true,
		false,
	])("lets no string from the report reach the model or the drawn text (source ids kept: %s)", (keepSourceIds) => {
		const poisoned = withCanaries(
			report(),
			"report",
			keepSourceIds,
		) as UsagePatternsReport;
		const model = buildShareCardModel(
			shareCardInputFromReport(poisoned),
			ALL_ON,
		);
		const drawn = planShareCard(model)
			.ops.flatMap((op) => (op.kind === "text" ? [op.text] : []))
			.join("\n");
		expect(JSON.stringify(model)).not.toContain("CANARY");
		expect(drawn).not.toContain("CANARY");
	});

	it("never passes rhythm counts through, only levels", () => {
		const model = buildShareCardModel(
			shareCardInputFromReport(report()),
			ALL_ON,
		);
		expect(
			model.rhythm?.flat().every((level) => [0, 1, 2, 3, 4].includes(level)),
		).toBe(true);
	});

	it("keeps the model to a known set of fields", () => {
		const model = buildShareCardModel(
			shareCardInputFromReport(report()),
			ALL_ON,
		);
		// Adding a field to the card is a privacy decision: update this list on purpose.
		expect(Object.keys(model).sort()).toEqual([
			"agents",
			"brand",
			"footer",
			"hero",
			"rangeLabel",
			"rhythm",
			"stats",
			"title",
			"variant",
		]);
		expect(model.footer.disclosure).toBe(SHARE_CARD_DISCLOSURE);
	});
});

describe("shareCardInputFromReport", () => {
	it("reads the combined view, so every number describes the union of sources", () => {
		const input = shareCardInputFromReport(report());
		expect(input).toMatchObject({
			rangeDays: 30,
			startedSessions: 432,
			subagentRuns: 2431,
			activeDays: 28,
			longestStreakDays: 14,
			peakHour: 13,
			nightShare: 0.04,
		});
	});

	it("lists installed agents only", () => {
		const input = shareCardInputFromReport(
			report({
				sources: [
					source("codex", { roots: 10 }),
					source("claude-code", { installed: false, roots: 99 }),
				],
			}),
		);
		expect(input.agents.map((agent) => agent.id)).toEqual(["codex"]);
	});
});

describe("quantizeRhythm", () => {
	it("maps empty cells to 0 and the rest onto quartile levels", () => {
		const levels = quantizeRhythm([[0, 1, 2, 3, 4, 5, 6, 7, 100]]);
		expect(levels[0]?.[0]).toBe(0);
		const nonzero = levels[0]?.slice(1) ?? [];
		expect(nonzero[0]).toBe(1);
		expect(nonzero[nonzero.length - 1]).toBe(4);
		// Monotone: a busier hour is never drawn lighter.
		for (let i = 1; i < nonzero.length; i += 1) {
			expect(nonzero[i]).toBeGreaterThanOrEqual(nonzero[i - 1] as number);
		}
	});

	it("keeps a single busy hour from flattening every other cell", () => {
		const counts = matrix((weekday, hour) =>
			weekday === 0 && hour === 9 ? 400 : hour % 3 === 0 ? 2 : 1,
		);
		const levels = quantizeRhythm(counts).flat();
		expect(levels.filter((level) => level >= 2).length).toBeGreaterThan(
			levels.length / 4,
		);
	});

	it("draws uniform activity at a visible level", () => {
		expect(quantizeRhythm([[0, 2, 2]])).toEqual([[0, 3, 3]]);
	});
});

describe("buildShareCardModel", () => {
	const input = () => shareCardInputFromReport(report());

	it("leads with sessions started and moves subagent runs into the facts", () => {
		const model = buildShareCardModel(input(), ALL_ON);
		expect(model.title).toBe(SHARE_CARD_TITLE);
		expect(model.title).toBe("Usage profile");
		expect(model.hero).toEqual({
			value: "432",
			label: "agent sessions started",
			facts: "+2,431 subagent runs · peak 13:00",
		});
		expect(model.stats).toEqual([
			{ value: "28", label: "active days" },
			{ value: "14d", label: "longest streak" },
			{ value: "85%", label: "orchestrated" },
		]);
	});

	it("mentions the night share once it is a habit", () => {
		const model = buildShareCardModel({ ...input(), nightShare: 0.31 }, ALL_ON);
		expect(model.hero.facts).toContain("31% after midnight");
	});

	it("orders agents by sessions started and keeps every one of them", () => {
		const model = buildShareCardModel(input(), ALL_ON);
		expect(model.agents.map((agent) => agent.name)).toEqual([
			"Codex",
			"Cline",
			"Claude Code",
		]);
		expect(model.agents[0]).toMatchObject({
			started: "371",
			detail: "73% orchestrated",
		});
		expect(model.agents[0]?.share).toBeCloseTo(371 / 432);
	});

	it("picks the template from the toggles", () => {
		const variant = (includeRhythm: boolean, includeAgents: boolean) =>
			buildShareCardModel(input(), {
				includeRhythm,
				includeAgents,
				includeStreaks: false,
			}).variant;
		expect(variant(true, true)).toBe("rhythm+agents");
		expect(variant(true, false)).toBe("rhythm");
		expect(variant(false, true)).toBe("agents");
		expect(variant(false, false)).toBe("minimal");
		const bare = buildShareCardModel(input(), {
			includeRhythm: false,
			includeAgents: false,
			includeStreaks: false,
		});
		expect(bare.rhythm).toBeNull();
		expect(bare.agents).toEqual([]);
		expect(bare.stats.map((stat) => stat.label)).toEqual([
			"active days",
			"orchestrated",
		]);
	});

	it("says so when the window is empty", () => {
		const model = buildShareCardModel(
			{
				...input(),
				startedSessions: 0,
				subagentRuns: 0,
				peakHour: null,
				nightShare: 0,
				agents: [],
			},
			ALL_ON,
		);
		expect(model.hero.facts).toBe("No sessions in this window yet");
		expect(model.stats.at(-1)).toEqual({ value: "0%", label: "orchestrated" });
	});
});

describe("defaultShareCardToggles", () => {
	it("starts the rhythm off for windows shorter than two weeks", () => {
		expect(defaultShareCardToggles(7).includeRhythm).toBe(false);
		expect(defaultShareCardToggles(30).includeRhythm).toBe(true);
	});
});

describe("formatCount", () => {
	it("keeps small numbers exact and compacts large ones, billions included", () => {
		expect(formatCount(2431)).toBe("2,431");
		expect(formatCount(81_100)).toBe("81.1K");
		expect(formatCount(9_900_000_000)).toBe("9.9B");
	});
});

describe("renderShareCard", () => {
	it("returns null when there is no document to draw in", () => {
		expect(
			renderShareCard(
				buildShareCardModel(shareCardInputFromReport(report()), ALL_ON),
			),
		).toBe(null);
	});
});

describe("shareCardFileName", () => {
	it("names the file after the window and the day", () => {
		const name = shareCardFileName(30, Date.UTC(2026, 8, 16, 12));
		expect(name).toMatch(/^cline-usage-30d-\d{8}\.png$/);
	});
});
