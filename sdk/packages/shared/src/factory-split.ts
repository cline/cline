import { z } from "zod";
import type { FactoryTaskConfig } from "./factory";
import {
	factoryCardCostLimitUsd,
	factoryRepositoryPathSchema,
} from "./factory";
import type { FactoryCardState } from "./factory-card-state";
import type { AgendaTaskStatus } from "./tasks";

/**
 * Splitting a large request into parts: the scoper may answer with a
 * breakdown instead of a plan, a person approves it once (from the app), and
 * each part becomes its own card linked to the original (the parent). One
 * level only. A part may wait for earlier parts' pull requests to be merged.
 */

/** Parts in one breakdown, at most. */
export const FACTORY_SPLIT_MAX_PARTS = 6;
/** Earlier parts one part may wait for, at most. */
export const FACTORY_SPLIT_MAX_PREREQUISITES = 3;
/** Parts in the longest chain of waiting parts, at most. */
export const FACTORY_SPLIT_MAX_CHAIN = 3;

const normalizedTitle = (title: string) =>
	title.trim().toLowerCase().replace(/\s+/g, " ");
const pathOverlaps = (a: string, b: string) => {
	const left = a.replace(/\/+$/, "");
	const right = b.replace(/\/+$/, "");
	return (
		left === right ||
		left.startsWith(`${right}/`) ||
		right.startsWith(`${left}/`)
	);
};

/** Indices of every part that `index` waits for, directly or through others. */
function prerequisitesOf(
	parts: readonly { dependsOn: readonly number[] }[],
	index: number,
): Set<number> {
	const found = new Set<number>();
	const visit = (at: number) => {
		for (const earlier of parts[at]?.dependsOn ?? []) {
			if (found.has(earlier)) continue;
			found.add(earlier);
			visit(earlier);
		}
	};
	visit(index);
	return found;
}

const factorySplitPartSchema = z
	.object({
		title: z.string().trim().min(1).max(160),
		/** A self-contained request; the part's own scoper sees only this and the goal. */
		brief: z.string().trim().min(1).max(20_000),
		/** Repository paths the part changes. */
		paths: z.array(factoryRepositoryPathSchema).min(1).max(30),
		/** Zero-based positions of earlier parts whose pull requests must be merged first. */
		dependsOn: z
			.array(z.number().int().nonnegative())
			.max(FACTORY_SPLIT_MAX_PREREQUISITES)
			.default([]),
	})
	.strict();

/**
 * The scoper's breakdown, a proposal until a person approves it. Validated
 * here: 2..FACTORY_SPLIT_MAX_PARTS parts with distinct titles; each waits
 * only for earlier parts (acyclic), at most FACTORY_SPLIT_MAX_CHAIN parts in
 * a chain; parts with no waiting path between them change no common path.
 */
export const factoryDesignSplitSchema = z
	.object({
		rationale: z.string().trim().min(1).max(4000),
		goal: z.string().trim().min(1).max(4000),
		parts: z.array(factorySplitPartSchema).min(2).max(FACTORY_SPLIT_MAX_PARTS),
	})
	.strict()
	.superRefine((split, context) => {
		const titles = new Set<string>();
		const depth: number[] = [];
		for (const [index, part] of split.parts.entries()) {
			const title = normalizedTitle(part.title);
			if (titles.has(title))
				context.addIssue({
					code: "custom",
					path: ["parts", index, "title"],
					message: `Part titles must differ: "${part.title}" repeats an earlier part`,
				});
			titles.add(title);
			if (new Set(part.dependsOn).size !== part.dependsOn.length)
				context.addIssue({
					code: "custom",
					path: ["parts", index, "dependsOn"],
					message: "dependsOn lists a part twice",
				});
			if (part.dependsOn.some((earlier) => earlier >= index)) {
				context.addIssue({
					code: "custom",
					path: ["parts", index, "dependsOn"],
					message: "A part may depend only on earlier parts",
				});
				depth.push(1);
				continue;
			}
			depth.push(
				1 +
					Math.max(0, ...part.dependsOn.map((earlier) => depth[earlier] ?? 1)),
			);
			if ((depth[index] ?? 1) > FACTORY_SPLIT_MAX_CHAIN)
				context.addIssue({
					code: "custom",
					path: ["parts", index, "dependsOn"],
					message: `At most ${FACTORY_SPLIT_MAX_CHAIN} parts may wait on each other in a chain`,
				});
		}
		for (const [index, part] of split.parts.entries()) {
			const before = prerequisitesOf(split.parts, index);
			for (let other = 0; other < index; other++) {
				// Parts in one waiting chain land in order, so they may share files.
				if (before.has(other)) continue;
				const shared = part.paths.find((path) =>
					split.parts[other]?.paths.some((theirs) =>
						pathOverlaps(path, theirs),
					),
				);
				if (shared)
					context.addIssue({
						code: "custom",
						path: ["parts", index, "paths"],
						message: `Parts ${other + 1} and ${index + 1} both change ${shared}; parts that edit the same file are one part`,
					});
			}
		}
	});
export type FactoryDesignSplit = z.infer<typeof factoryDesignSplitSchema>;

/** The designer's final response when it splits the request. */
export const factoryDesignSplitResponseSchema = z
	.object({ split: factoryDesignSplitSchema })
	.strict();

/**
 * An approved breakdown, stored on the parent with its status set to
 * `completed` in the same write. `splitId` is random per approval and feeds
 * each part's task id. `createdAt`: every kept part was created (until then
 * the Hub creates the missing ones on start). `cancelledAt`: the person
 * cancelled the remaining parts; no further part is created.
 */
export const factorySplitRecordSchema = z.object({
	splitId: z.string().min(1),
	/** The parent revision whose proposal was approved. */
	revision: z.number().int().positive(),
	approvedAt: z.string(),
	goal: z.string(),
	parts: z
		.array(
			z.object({
				title: z.string(),
				brief: z.string(),
				paths: z.array(z.string()),
				dependsOn: z.array(z.number().int().nonnegative()),
				taskId: z.string().min(1),
				/** Left out at approval; no card exists for it. */
				omitted: z.literal(true).optional(),
			}),
		)
		.min(1)
		.max(FACTORY_SPLIT_MAX_PARTS),
	createdAt: z.string().optional(),
	cancelledAt: z.string().optional(),
});
export type FactorySplitRecord = z.infer<typeof factorySplitRecordSchema>;

/**
 * On a part that waits for earlier parts: their task ids, and which of them
 * merged into this part's base branch (latched when first seen, never
 * recomputed: archiving or stopping the earlier card later does not undo
 * it). Only the engine writes these. `startedAnyway`: the person started it
 * without waiting.
 */
export const factoryBlockedBySchema = z.object({
	taskIds: z
		.array(z.string().min(1))
		.min(1)
		.max(FACTORY_SPLIT_MAX_PREREQUISITES),
	met: z.record(z.string(), z.object({ at: z.string(), prUrl: z.string() })),
	/**
	 * Earlier parts whose pull request merged into `baseBranch`, not this
	 * part's base (`expected`). Settled like `met`: the person decides.
	 */
	mergedElsewhere: z
		.record(
			z.string(),
			z.object({
				at: z.string(),
				prUrl: z.string(),
				baseBranch: z.string(),
				expected: z.string(),
			}),
		)
		.optional(),
	/**
	 * Earlier parts whose pull request Factory failed to read repeatedly (gh
	 * missing or signed out, or a URL gh cannot read). Removed when a later
	 * read succeeds.
	 */
	unreadable: z
		.record(z.string(), z.object({ at: z.string(), prUrl: z.string() }))
		.optional(),
	startedAnyway: z.object({ at: z.string() }).optional(),
});
export type FactoryBlockedBy = z.infer<typeof factoryBlockedBySchema>;

/**
 * What a host knows about one earlier part, read from its records:
 * undefined `task` when the card was deleted. `run` is its current run.
 */
export interface FactoryPrerequisiteFacts {
	taskId: string;
	/** Short id such as `F41`, for wording. */
	factoryId?: string;
	task?: { status: AgendaTaskStatus; revision: number; archivedAt?: string };
	run?: {
		taskRevision?: number;
		factory?: {
			pullRequestUrl?: string;
			pullRequestOutcome?: { state: "merged" | "closed" };
		};
	};
}

/**
 * Whether a waiting part may start. `waiting`: an earlier part is still being
 * worked, or delivered (or archived) with its pull request open or merged
 * but not yet latched (it holds no slot and keeps its place in the queue).
 * `unavailable`: an earlier part will not merge into this part's base
 * (cancelled, expired, deleted, archived or delivered without a pull
 * request, its pull request closed unmerged or merged into another branch,
 * or unreadable); the person starts it anyway or cancels it. `on` names the
 * earlier parts by short id.
 */
export type FactoryDependencyState =
	| { state: "ready" }
	| { state: "waiting"; on: string[] }
	| { state: "unavailable"; on: string[]; reason: string };

/**
 * The dependency state of a part from its stored links and its earlier
 * parts' facts. Pure: the engine's start gate and every host derive it the
 * same way; nothing about it is stored. Only the engine's latch (`met`)
 * releases a part: a merge it has not latched yet still reads as waiting.
 */
export function factoryDependencyState(
	blockedBy: FactoryBlockedBy | undefined,
	prerequisites: readonly FactoryPrerequisiteFacts[],
): FactoryDependencyState {
	if (!blockedBy || blockedBy.startedAnyway) return { state: "ready" };
	const waiting: string[] = [];
	for (const taskId of blockedBy.taskIds) {
		if (blockedBy.met[taskId]) continue;
		const facts = prerequisites.find((entry) => entry.taskId === taskId);
		const name = facts?.factoryId ?? taskId;
		const task = facts?.task;
		const run =
			facts?.run &&
			(facts.run.taskRevision === undefined ||
				facts.run.taskRevision === task?.revision)
				? facts.run.factory
				: undefined;
		const unavailable = (reason: string): FactoryDependencyState => ({
			state: "unavailable",
			on: [name],
			reason,
		});
		const elsewhere = blockedBy.mergedElsewhere?.[taskId];
		if (elsewhere)
			return unavailable(
				`${name} merged into ${elsewhere.baseBranch}, not ${elsewhere.expected}`,
			);
		if (!task) return unavailable(`${name} was deleted`);
		if (task.status === "cancelled")
			return unavailable(`${name} was cancelled`);
		if (task.status === "expired") return unavailable(`${name} expired`);
		if (run?.pullRequestOutcome?.state === "closed")
			return unavailable(`${name} was closed without merging`);
		if (blockedBy.unreadable?.[taskId])
			return unavailable(
				`Factory cannot check whether ${name}'s pull request merged (gh is missing, signed out or cannot read it)`,
			);
		if (task.archivedAt && !run?.pullRequestUrl)
			return unavailable(
				`${name} was archived before it opened a pull request`,
			);
		if (task.status === "completed" && !run?.pullRequestUrl)
			return unavailable(`${name} was delivered without a pull request`);
		waiting.push(name);
	}
	return waiting.length
		? { state: "waiting", on: waiting }
		: { state: "ready" };
}

/** "F41", "F41 and F42", "F41, F42 and F43". */
export function factoryCardList(ids: readonly string[]): string {
	return ids.length <= 1
		? (ids[0] ?? "")
		: `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

/**
 * Progress of a parent's parts, derived on read from each part's card state
 * (undefined for a part whose card was deleted: it counts as removed).
 * `delivered` includes parts delivered with open findings and merged ones;
 * `closed` counts cancelled, expired, archived-before-delivery and removed
 * parts; `open` is the rest. All settled (open 0) means the parent is done.
 */
export interface FactoryPartsSummary {
	total: number;
	delivered: number;
	merged: number;
	open: number;
	/** Open parts waiting on the person (they are in Needs you themselves). */
	needsYou: number;
	stopped: number;
	closed: number;
}

type FactoryPartState = Pick<
	FactoryCardState,
	"kind" | "waitingOn" | "stage" | "deliverable"
>;

/** Where one part stands for its parent (see FactoryPartsSummary). */
export function factoryPartStanding(
	part: FactoryPartState | undefined,
): "delivered" | "closed" | "open" {
	if (
		part?.kind === "delivered" ||
		part?.kind === "delivered_with_findings" ||
		// An archived card keeps the stage it reached.
		(part?.kind === "archived" && part.stage === "delivered")
	)
		return "delivered";
	return !part || part.kind === "closed" || part.kind === "archived"
		? "closed"
		: "open";
}

export function factoryPartsSummary(
	parts: readonly (FactoryPartState | undefined)[],
): FactoryPartsSummary {
	const summary: FactoryPartsSummary = {
		total: parts.length,
		delivered: 0,
		merged: 0,
		open: 0,
		needsYou: 0,
		stopped: 0,
		closed: 0,
	};
	for (const part of parts) {
		const standing = factoryPartStanding(part);
		summary[standing]++;
		if (standing === "delivered" && part?.deliverable?.outcome === "merged")
			summary.merged++;
		if (standing !== "open") continue;
		if (part?.waitingOn === "person") summary.needsYou++;
		if (part?.kind === "stopped") summary.stopped++;
	}
	return summary;
}

/**
 * The engine's facts a person sees before approving a breakdown, as plain
 * lines above the scoper's rationale: how many cards and draft PRs it
 * creates, the most it can spend against today's remaining budget, and
 * whether parts ask again. Which parts wait for which merges is each part's
 * `dependsOn`, shown with that part.
 */
export function factorySplitApprovalFacts(input: {
	config: Pick<
		FactoryTaskConfig,
		"publishPullRequest" | "maxCostUsd" | "autonomy" | "approval"
	>;
	split: Pick<FactoryDesignSplit, "parts">;
	/** Leave these zero-based parts out. */
	omit?: readonly number[];
	/**
	 * Today's limit and spend (task.factory.limits.get); null: no daily
	 * limit; omitted: not known, so today's budget goes unmentioned.
	 */
	dailyCostUsd?: number | null;
	spentTodayUsd?: number;
}): string[] {
	const count = input.split.parts.filter(
		(_part, index) => !input.omit?.includes(index),
	).length;
	const cards = `${count} ${count === 1 ? "card" : "cards"}`;
	const lines = [
		input.config.publishPullRequest
			? `Creates ${cards}, each opening its own draft PR (${count} draft ${count === 1 ? "PR" : "PRs"}). Factory never merges them.`
			: `Creates ${cards}, each delivering its own branch.`,
	];
	const perCard = factoryCardCostLimitUsd(input.config);
	if (perCard !== undefined) {
		const remaining =
			input.dailyCostUsd === undefined
				? ""
				: input.dailyCostUsd === null
					? " (no daily limit)"
					: ` ($${Math.max(0, input.dailyCostUsd - (input.spentTodayUsd ?? 0)).toFixed(2)} of today's budget left)`;
		lines.push(
			`Spends at most ${count} × $${perCard.toFixed(2)} = $${(count * perCard).toFixed(2)}${remaining}.`,
		);
	}
	lines.push(
		input.config.approval === "automatic"
			? "Parts run without asking again unless a part's own plan is large."
			: "Each part's plan waits for your approval.",
	);
	return lines;
}
