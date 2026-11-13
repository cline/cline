// @vitest-environment jsdom
/**
 * The desktop agrees with factoryCardState for every shared card fixture:
 * the stage line (from the board's outcome and from the card's own run), the
 * Needs you decision and the card header's headline. Core checks the status
 * tool against the same fixtures (factory-card-agreement.test.ts).
 */
import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	compareFactoryNeedsYou,
	factoryCardState,
	factoryPartsSummary,
	factoryPlanApprovalBlocker,
} from "@cline/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { factoryStoppedLabel } from "@/components/views/factory/factory-line";
import { activeFactorySessions } from "@/components/views/factory/factory-live";
import type { FactorySplitContext } from "@/components/views/factory/factory-split";
import { FactoryTaskHeader } from "@/components/views/factory/factory-task-header";
import {
	factoryActivity,
	factoryNeedsYou,
	factoryUrgency,
} from "@/components/views/factory/factory-ui";
import type { FactoryAttention } from "@/hooks/use-factory-attention";
import {
	FACTORY_BOARD_FIXTURES,
	FACTORY_CARD_FIXTURES,
	FACTORY_NEEDS_YOU_ORDER,
	FACTORY_PR_REVIEW_CARD_FIXTURES,
	FACTORY_SPLIT_CARD_FIXTURES,
	type FactoryCardFixture,
	// biome-ignore lint/style/noRestrictedImports: the card fixtures are shared test data, not part of @cline/shared's published entrypoints
} from "../../../../../sdk/packages/shared/src/__tests__/factory-card-fixtures";
import {
	currentFactoryRunState,
	factoryAttentionOutcome,
	factoryAttentionReasons,
	factoryStation,
} from "./factory-attention";
import { FACTORY_LINE } from "./factory-copy";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) },
	openExternalUrl: vi.fn(),
}));

/** The card header's headline for each fixture. */
const HEADLINE: Record<string, string> = {
	"held before scoping": "On hold",
	"queued for scoping": "Waiting to start",
	scoping: "Scoping",
	"scoping question": "Scoping",
	"plan to approve": "Plan ready for your approval",
	"plan held: large change": "Plan ready for your approval",
	"plan held: open findings": "Plan ready for your approval",
	"plan held: changed by you": "Plan ready for your approval",
	"plan held: not ready": "Plan ready for your approval",
	"plan that cannot be approved": "Plan not ready to approve",
	"designer conclusion": "No build needed",
	"scoping stopped on a pending card": "Scoping stopped",
	"scoping failed": "Scoping stopped",
	"queued to run": "Approved · waiting to build",
	"automatic retry queued": "Approved · waiting to build",
	"retried by a person after a stop": "Approved · waiting to build",
	building: "Building",
	"running checks": "Building · running 1 check",
	verifying: "Testing the running app",
	reviewing: "Reviewing code",
	publishing: "Opening draft PR",
	"run blocked before its stop is recorded": "Review findings were not cleared",
	"stopped while building": "Stopped",
	"draft PR could not open": "Could not open the draft PR",
	"plan fault": "Stopped",
	"draft PR left open with findings":
		"Draft PR open · reviewer has 2 unresolved findings",
	"delivered, stamp required": "Needs your review",
	"draft PR ready": "Draft PR ready",
	"draft PR watched": "Watching CI on the draft PR",
	"draft PR merged": "Merged as delivered",
	"draft PR closed": "Closed without merging",
	"PR follow-up paused": "Draft PR ready",
	"flagged delivery": "Draft PR ready",
	"flagged delivery recorded as a stop by an older Hub": "Draft PR ready",
	"proposed rule": "Review proposed rule",
	"unrated hands-off delivery": "Ready for you",
	"PR follow-up stopped after delivery": "Blocked",
	"flagged delivery whose PR follow-up stopped": "Blocked",
	cancelled: "Cancelled",
	"archived after a stop": "Archived",
	"manual card not started": "Not started",
	"hands-off card not started": "Not started",
};

/**
 * The board cannot tell these apart from what the sidecar sends (no run
 * error or candidate): only the card header, with the run state, can.
 */
const BOARD_STAGE_UNKNOWN = new Set([
	"run blocked before its stop is recorded",
]);
/**
 * The card header reads a run only once it executes, so a queued automatic
 * retry shows Waiting there; the board, told by the sidecar, shows Build.
 */
const HEADER_STAGE_UNKNOWN = new Set(["automatic retry queued"]);
const EXECUTING = ["in_progress", "completed", "failed"];

const retryRuns = (run: AgendaTaskRunRecord | undefined) =>
	run
		? [
				{
					runId: run.runId,
					taskRevision: run.taskRevision,
					createdAt: run.createdAt,
					status: run.status,
				},
			]
		: [];

/** The board's attention for a card, as the sidecar builds it (factory-commands.ts). */
function attentionOf(
	task: AgendaTaskRecord,
	run: AgendaTaskRunRecord | undefined,
): FactoryAttention | undefined {
	if (task.archivedAt) return undefined;
	const state = currentFactoryRunState(task, run);
	const runs = retryRuns(run);
	if (!task.factory) throw new Error("Every card fixture is a Factory card");
	const reasons = factoryAttentionReasons(
		{ ...task, factory: task.factory },
		state,
		runs,
	);
	return {
		taskId: task.taskId,
		revision: task.revision,
		runId: state ? run?.runId : undefined,
		questions: [],
		needsAttention: reasons.length > 0,
		// The sidecar's own projection of the run.
		outcome: state ? factoryAttentionOutcome(task, state, runs) : undefined,
	} as FactoryAttention;
}

async function headlineOf(
	fixture: FactoryCardFixture,
	split?: FactorySplitContext,
) {
	const { task, run } = fixture;
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<FactoryTaskHeader
				task={task}
				busy={false}
				designActive={
					Boolean(fixture.working) && task.status === "pending_approval"
				}
				state={run?.factory}
				approvalReason={
					task.status === "pending_approval" && task.factory
						? factoryPlanApprovalBlocker({ ...task, factory: task.factory })
						: null
				}
				runs={retryRuns(run)}
				onBack={vi.fn()}
				onArchive={vi.fn()}
				onDelete={vi.fn()}
				split={split}
			/>,
		),
	);
	const progress = container.querySelector('[aria-label="Task progress"]');
	const result = {
		headline: progress?.querySelector("strong")?.textContent,
		stopped: Boolean(container.querySelector('[data-state="stopped"]')),
	};
	await act(async () => root.unmount());
	container.remove();
	return result;
}

describe("the desktop agrees with factoryCardState", () => {
	it("covers every fixture", () => {
		expect(Object.keys(HEADLINE).sort()).toEqual(
			FACTORY_CARD_FIXTURES.map((fixture) => fixture.name).sort(),
		);
	});

	it.each(
		FACTORY_CARD_FIXTURES.map((fixture) => [fixture.name, fixture] as const),
	)("%s", async (name, fixture) => {
		const { task, run } = fixture;
		const state = run?.factory;
		// The board's row: Needs you, and where the card is.
		const activity = factoryActivity(task, attentionOf(task, run));
		expect(factoryNeedsYou(activity)).toBe(fixture.card.waitingOn === "person");
		// Archiving does not move a card on its line.
		const stopped =
			factoryCardState({
				task: { ...task, archivedAt: undefined },
				lastRun: run,
			}).kind === "stopped";
		expect(activity.station.stopped).toBe(stopped);
		if (stopped)
			expect(factoryStoppedLabel(activity.station)).toBe(
				fixture.card.reasonCode === "publish_failed"
					? "Stopped opening the draft PR"
					: `Stopped at ${FACTORY_LINE.stations[activity.station.station]}`,
			);
		if (!BOARD_STAGE_UNKNOWN.has(name))
			expect(activity.station.station).toBe(fixture.card.stage);
		// The card's own line, from its run state as the header passes it.
		const own = factoryStation(
			task,
			state && EXECUTING.includes(task.status)
				? { ...state, activeSessions: activeFactorySessions(state.attempts) }
				: undefined,
		);
		expect(own.stopped).toBe(stopped);
		if (!HEADER_STAGE_UNKNOWN.has(name)) {
			expect(own.station).toBe(fixture.card.stage);
			expect(Boolean(own.checks)).toBe(Boolean(fixture.card.checks));
		}
		// The header: its headline, and a stop marked on its line only for a stop.
		const header = await headlineOf(fixture);
		expect(header.headline).toBe(HEADLINE[name]);
		expect(header.stopped).toBe(fixture.card.kind === "stopped");
		// The fixture's own answer, for the record.
		expect(
			factoryCardState({
				task,
				lastRun: run,
				live: {
					designLive:
						Boolean(fixture.working) && task.status === "pending_approval",
					runLive:
						Boolean(fixture.working) && task.status !== "pending_approval",
				},
				...(task.status === "pending_approval" && task.factory
					? {
							planApprovable:
								factoryPlanApprovalBlocker({
									...task,
									factory: task.factory,
								}) === null,
						}
					: {}),
			}),
		).toMatchObject(fixture.card);
	});
});

describe("the board's Needs you order", () => {
	it("is factory_status' order for the same cards", () => {
		// The board's own sort: factory-view.tsx's needsYou.
		const order = FACTORY_BOARD_FIXTURES.flatMap((fixture) => {
			const activity = factoryActivity(
				fixture.task,
				attentionOf(fixture.task, fixture.run),
			);
			return factoryNeedsYou(activity)
				? [
						{
							fixture,
							task: fixture.task,
							urgency: factoryUrgency(activity.label),
						},
					]
				: [];
		})
			.sort(compareFactoryNeedsYou)
			.map(({ fixture }) => fixture.name);
		expect(order).toEqual(FACTORY_NEEDS_YOU_ORDER);
	});
});

/** Where the board lists each split fixture, and its card header's headline. */
const SPLIT_CARDS: Record<string, { column: string; headline: string }> = {
	"breakdown to approve": {
		column: "Needs you",
		headline: "Breakdown ready for your approval",
	},
	"parent tracking its parts": {
		column: "Working",
		headline: "Split into 2 parts",
	},
	"parent with every part settled": {
		column: "Done",
		headline: "Every part is delivered or closed",
	},
	"parent whose parts were all cancelled": {
		column: "Done",
		headline: "Every part closed before it was delivered",
	},
	"part waiting for an earlier merge": {
		column: "Queued",
		headline: "Waiting for F41 to merge",
	},
	"part whose earlier part closed unmerged": {
		column: "Needs you",
		headline: "F41 was closed without merging",
	},
};

describe("the desktop agrees with factoryCardState for split cards", () => {
	it.each(
		FACTORY_SPLIT_CARD_FIXTURES.map(
			(fixture) => [fixture.name, fixture] as const,
		),
	)("%s", async (name, fixture) => {
		const { task, run } = fixture;
		// The sidecar's link facts: the parts folded, the dependency as read.
		const links = {
			...(fixture.parts
				? {
						parts: factoryPartsSummary(fixture.parts.map((part) => part.state)),
					}
				: {}),
			...(fixture.dependency ? { dependency: fixture.dependency } : {}),
		};
		const attention = attentionOf(task, run);
		const activity = factoryActivity(
			task,
			attention && { ...attention, ...links },
		);
		expect(activity.column).toBe(SPLIT_CARDS[name]?.column);
		expect(factoryNeedsYou(activity)).toBe(fixture.card.waitingOn === "person");
		expect(activity.station.station).toBe(fixture.card.stage);
		const header = await headlineOf(fixture, { links });
		expect(header.headline).toBe(SPLIT_CARDS[name]?.headline);
		expect(factoryCardState({ task, lastRun: run, ...links })).toMatchObject(
			fixture.card,
		);
	});
});

/** Where the board lists each pull request review fixture, and its headline. */
const REVIEW_CARDS: Record<string, { column: string; headline: string }> = {
	"review queued": { column: "Queued", headline: "Waiting to review" },
	reviewing: { column: "Working", headline: "Reviewing" },
	"review draft ready": { column: "Done", headline: "Review draft ready" },
	"review posted": { column: "Done", headline: "Review posted" },
	"review stopped": { column: "Needs you", headline: "Review stopped" },
};

describe("the desktop agrees with factoryCardState for pull request reviews", () => {
	it.each(
		FACTORY_PR_REVIEW_CARD_FIXTURES.map(
			(fixture) => [fixture.name, fixture] as const,
		),
	)("%s", async (name, fixture) => {
		const { task, run } = fixture;
		const activity = factoryActivity(task, attentionOf(task, run));
		expect(activity.column).toBe(REVIEW_CARDS[name]?.column);
		expect(factoryNeedsYou(activity)).toBe(fixture.card.waitingOn === "person");
		expect(activity.station.station).toBe(fixture.card.stage);
		// Scope, Build and Verify never ran, wherever the card is.
		expect(activity.station.skipped).toEqual(["scope", "build", "verify"]);
		const header = await headlineOf(fixture);
		expect(header.headline).toBe(REVIEW_CARDS[name]?.headline);
		expect(header.stopped).toBe(fixture.card.kind === "stopped");
	});
});
