import { describe, expect, it } from "vitest";
import { factoryCardState } from "./factory-card-state";
import {
	type FactoryPrerequisiteFacts,
	factoryDependencyState,
	factoryDesignSplitSchema,
	factoryPartStanding,
	factoryPartsSummary,
	factorySplitApprovalFacts,
} from "./factory-split";

const part = (title: string, paths: string[], dependsOn: number[] = []) => ({
	title,
	brief: `Do ${title}`,
	paths,
	dependsOn,
});
const split = (parts: ReturnType<typeof part>[]) => ({
	rationale: "Separate changes",
	goal: "Ship both",
	parts,
});
const problems = (parts: ReturnType<typeof part>[]) => {
	const parsed = factoryDesignSplitSchema.safeParse(split(parts));
	return parsed.success
		? []
		: parsed.error.issues.map((issue) => issue.message);
};

describe("factoryDesignSplitSchema", () => {
	it("accepts independent parts on separate paths, and ordered parts on shared ones", () => {
		expect(
			problems([
				part("Export", ["src/export"]),
				part("Footer", ["src/footer.ts"]),
			]),
		).toEqual([]);
		expect(
			problems([
				part("Schema", ["src/db"]),
				part("Reader", ["src/db/read.ts"], [0]),
			]),
		).toEqual([]);
	});

	it.each([
		[
			"a part that waits for a later one",
			[part("A", ["a"], [1]), part("B", ["b"])],
			/only on earlier parts/,
		],
		[
			"independent parts editing the same file",
			[part("A", ["src/x.ts"]), part("B", ["src"])],
			/both change src/,
		],
		[
			"a chain longer than three",
			[
				part("A", ["a"]),
				part("B", ["b"], [0]),
				part("C", ["c"], [1]),
				part("D", ["d"], [2]),
			],
			/At most 3 parts/,
		],
		[
			"repeated titles",
			[part("Rename it", ["a"]), part("rename  IT", ["b"])],
			/titles must differ/,
		],
		["one part", [part("A", ["a"])], />=2|at least 2/i],
		[
			"seven parts",
			Array.from({ length: 7 }, (_, index) => part(`P${index}`, [`p${index}`])),
			/<=6|at most 6/i,
		],
	])("refuses %s", (_label, parts, message) => {
		expect(problems(parts).join("\n")).toMatch(message);
	});
});

describe("factoryDependencyState", () => {
	const blockedBy = { taskIds: ["task_a"], met: {} };
	const earlier = (
		facts: Partial<FactoryPrerequisiteFacts> = {},
	): FactoryPrerequisiteFacts => ({
		taskId: "task_a",
		factoryId: "F41",
		task: { status: "completed", revision: 1 },
		run: {
			taskRevision: 1,
			factory: { pullRequestUrl: "https://github.com/o/r/pull/1" },
		},
		...facts,
	});

	it("waits while the earlier part's pull request is open or it is still worked", () => {
		expect(factoryDependencyState(blockedBy, [earlier()])).toEqual({
			state: "waiting",
			on: ["F41"],
		});
		expect(
			factoryDependencyState(blockedBy, [
				earlier({ task: { status: "failed", revision: 1 }, run: undefined }),
			]),
		).toMatchObject({ state: "waiting" });
	});

	it("is ready once latched or started anyway, whatever became of the earlier card; a merge the engine has not latched still waits", () => {
		const met = {
			taskIds: ["task_a"],
			met: { task_a: { at: "t", prUrl: "u" } },
		};
		expect(factoryDependencyState(met, [])).toEqual({ state: "ready" });
		expect(
			factoryDependencyState(blockedBy, [
				earlier({
					run: {
						taskRevision: 1,
						factory: {
							pullRequestUrl: "https://github.com/o/r/pull/1",
							pullRequestOutcome: { state: "merged" },
						},
					},
				}),
			]),
		).toEqual({ state: "waiting", on: ["F41"] });
		expect(
			factoryDependencyState({ ...blockedBy, startedAnyway: { at: "t" } }, []),
		).toEqual({ state: "ready" });
	});

	it("waits on an archived earlier part with its pull request open, and needs the person when it was archived before it opened one", () => {
		const archived = {
			status: "pending_approval",
			revision: 1,
			archivedAt: "t",
		} as const;
		expect(
			factoryDependencyState(blockedBy, [
				earlier({ task: archived, run: undefined }),
			]),
		).toEqual({
			state: "unavailable",
			on: ["F41"],
			reason: "F41 was archived before it opened a pull request",
		});
		expect(
			factoryDependencyState(blockedBy, [
				earlier({ task: { ...archived, status: "completed" } }),
			]),
		).toEqual({ state: "waiting", on: ["F41"] });
		// The parent's line agrees: archived before delivery is closed.
		expect(
			factoryPartStanding(
				factoryCardState({ task: { ...archived, factory: {} } }),
			),
		).toBe("closed");
	});

	it.each([
		[
			"closed unmerged",
			earlier({
				run: {
					taskRevision: 1,
					factory: { pullRequestOutcome: { state: "closed" } },
				},
			}),
			"F41 was closed without merging",
		],
		[
			"cancelled",
			earlier({ task: { status: "cancelled", revision: 1 } }),
			"F41 was cancelled",
		],
		["deleted", { taskId: "task_a" }, "task_a was deleted"],
		[
			"delivered without a PR",
			earlier({ run: { taskRevision: 1, factory: {} } }),
			"F41 was delivered without a pull request",
		],
	])("needs the person when the earlier part was %s", (_label, facts, reason) => {
		expect(factoryDependencyState(blockedBy, [facts])).toEqual({
			state: "unavailable",
			on: [facts.factoryId ?? "task_a"],
			reason,
		});
	});

	it.each([
		[
			"merged into another branch",
			{
				mergedElsewhere: {
					task_a: {
						at: "t",
						prUrl: "u",
						baseBranch: "release",
						expected: "main",
					},
				},
			},
			"F41 merged into release, not main",
		],
		[
			"unreadable",
			{ unreadable: { task_a: { at: "t", prUrl: "u" } } },
			"Factory cannot check whether F41's pull request merged (gh is missing, signed out or cannot read it)",
		],
	])("needs the person when the engine found the earlier pull request %s", (_label, settled, reason) => {
		expect(
			factoryDependencyState({ ...blockedBy, ...settled }, [earlier()]),
		).toEqual({ state: "unavailable", on: ["F41"], reason });
	});
});

describe("factoryPartsSummary", () => {
	it("counts delivered (merged included), closed, removed and open parts", () => {
		const delivered = factoryCardState({
			task: { status: "completed", revision: 1, factory: {} },
			lastRun: {
				status: "completed",
				taskRevision: 1,
				factory: {
					phase: "ready",
					pullRequestUrl: "https://github.com/o/r/pull/1",
					pullRequestOutcome: { state: "merged", headChanged: false, at: "t" },
				},
			},
		});
		const stopped = factoryCardState({
			task: { status: "failed", revision: 1, error: "Builder failed" },
		});
		const cancelled = factoryCardState({
			task: { status: "cancelled", revision: 1 },
		});
		expect(
			factoryPartsSummary([delivered, stopped, cancelled, undefined]),
		).toEqual({
			total: 4,
			delivered: 1,
			merged: 1,
			open: 1,
			needsYou: 1,
			stopped: 1,
			closed: 2,
		});
	});
});

describe("factorySplitApprovalFacts", () => {
	it("states the draft PRs, the most it spends and whether parts ask again, leaving the order to each part", () => {
		expect(
			factorySplitApprovalFacts({
				config: {
					publishPullRequest: true,
					maxCostUsd: 5,
					autonomy: "hands_off",
					approval: "automatic",
				},
				split: {
					parts: [part("A", ["a"]), part("B", ["b"]), part("C", ["c"], [0])],
				},
				omit: [1],
				dailyCostUsd: 50,
				spentTodayUsd: 42,
			}),
		).toEqual([
			"Creates 2 cards, each opening its own draft PR (2 draft PRs). Factory never merges them.",
			"Spends at most 2 × $5.00 = $10.00 ($8.00 of today's budget left).",
			"Parts run without asking again unless a part's own plan is large.",
		]);
		// An unknown daily limit says nothing about today's budget.
		expect(
			factorySplitApprovalFacts({
				config: {
					publishPullRequest: false,
					maxCostUsd: 5,
					approval: "required",
				},
				split: { parts: [part("A", ["a"]), part("B", ["b"])] },
			}),
		).toEqual([
			"Creates 2 cards, each delivering its own branch.",
			"Spends at most 2 × $5.00 = $10.00.",
			"Each part's plan waits for your approval.",
		]);
	});
});
