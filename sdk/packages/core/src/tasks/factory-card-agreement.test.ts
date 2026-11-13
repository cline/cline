/**
 * The status tool's words agree with factoryCardState for every shared card
 * fixture. The desktop checks its stage line, Needs you and card header
 * against the same fixtures (webview/lib/factory-card-agreement.test.tsx).
 */
import { factoryCardState, factoryPlanApprovalBlocker } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	FACTORY_BOARD_FIXTURES,
	FACTORY_CARD_FIXTURES,
	FACTORY_NEEDS_YOU_ORDER,
	// biome-ignore lint/style/noRestrictedImports: the card fixtures are shared test data, not part of @cline/shared's published entrypoints
} from "../../../shared/src/__tests__/factory-card-fixtures";
import {
	createFactoryStatusTool,
	describeFactoryCard,
	type FactoryStage,
} from "./factory-tool";

/** What the tool says for each fixture: its stage and what happens next. */
const TOOL: Record<string, [stage: FactoryStage, next: string | RegExp]> = {
	"held before scoping": ["On hold", "Waits until someone starts it."],
	"queued for scoping": [
		"Waiting for a free slot",
		"Starts on its own when a working slot frees up.",
	],
	scoping: ["Scoping", "Continues on its own."],
	"scoping question": [
		"Scoping",
		"Waits for an answer to its question in Factory.",
	],
	"plan to approve": [
		"Waiting for plan approval",
		"Waits for someone to approve the plan in Factory.",
	],
	"plan held: large change": [
		"Waiting for plan approval",
		"Waits for someone to approve the plan in Factory: it is a large change.",
	],
	"plan held: open findings": [
		"Waiting for plan approval",
		/: its plan checkers still had findings/,
	],
	"plan held: changed by you": [
		"Waiting for plan approval",
		/: a person changed it after scoping\.$/,
	],
	"plan held: not ready": [
		"Waiting for plan approval",
		/: automatic approval could not approve it\.$/,
	],
	"plan that cannot be approved": [
		"Waiting for plan approval",
		/^Waits until someone revises the plan/,
	],
	"designer conclusion": [
		"Waiting for plan approval",
		"Waits for a person to confirm the designer's conclusion (already_fixed).",
	],
	"scoping stopped on a pending card": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	"scoping failed": ["Stopped", "Stays stopped until someone tries again."],
	"queued to run": [
		"Waiting for a free slot",
		"Starts on its own when a working slot frees up.",
	],
	"automatic retry queued": [
		"Waiting for a free slot",
		"Starts on its own when a working slot frees up.",
	],
	"retried by a person after a stop": [
		"Waiting for a free slot",
		"Starts on its own when a working slot frees up.",
	],
	building: ["Building", "Continues on its own."],
	"running checks": ["Running checks", "Continues on its own."],
	verifying: ["Verifying", "Continues on its own."],
	reviewing: ["Reviewing", "Continues on its own."],
	publishing: ["Publishing", "Continues on its own."],
	"run blocked before its stop is recorded": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	"stopped while building": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	"draft PR could not open": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	"plan fault": ["Stopped", "Stays stopped until someone tries again."],
	"draft PR left open with findings": [
		"Draft PR ready",
		/^Waits for a person to review the draft PR and its open findings/,
	],
	"delivered, stamp required": [
		"Draft PR ready",
		"Waits for a person to review the draft PR.",
	],
	"draft PR ready": [
		"Draft PR ready",
		"Waits for a person to review the draft PR.",
	],
	"draft PR watched": [
		"Draft PR ready",
		"Watches the draft PR and fixes failing checks or review feedback on its own.",
	],
	"draft PR merged": ["Delivered", "Nothing; the draft PR was merged."],
	"draft PR closed": [
		"Delivered",
		"Nothing; the draft PR was closed without merging.",
	],
	"PR follow-up paused": ["Draft PR ready", /^Waits: PR follow-up is paused/],
	"flagged delivery": ["Delivered", "Nothing; the work is delivered."],
	"flagged delivery recorded as a stop by an older Hub": [
		"Delivered",
		"Nothing; the work is delivered.",
	],
	"proposed rule": [
		"Delivered",
		"Waits for a person to save or discard the guidance rule Factory proposed from their note.",
	],
	"unrated hands-off delivery": [
		"Delivered",
		"Nothing; the work is delivered.",
	],
	"PR follow-up stopped after delivery": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	"flagged delivery whose PR follow-up stopped": [
		"Stopped",
		"Stays stopped until someone tries again.",
	],
	cancelled: ["Stopped", "Nothing; the card is closed."],
	"archived after a stop": [
		"Archived",
		"Nothing; the card is archived. Restoring it in Factory continues it.",
	],
	"manual card not started": ["Not started", "Waits until someone starts it."],
	"hands-off card not started": [
		"Not started",
		"Factory queues it for scoping on its own.",
	],
};

/** The needsYou phrase of every fixture that waits on the person; the others carry none. */
const NEEDS_YOU: Record<string, string | RegExp> = {
	"scoping question": "answer a question",
	"plan to approve": "approve the plan",
	"plan held: large change": "approve the plan (large change)",
	"plan held: open findings": "approve the plan (reviewers still object)",
	"plan held: changed by you": "approve the plan (you changed it)",
	"plan held: not ready":
		"approve the plan (automatic approval could not approve it)",
	"designer conclusion": "confirm the designer's conclusion",
	"scoping stopped on a pending card": /^stopped: \S/,
	"scoping failed": /^stopped: Design /,
	"run blocked before its stop is recorded": /^stopped: \S/,
	"stopped while building": /^stopped: \S/,
	"draft PR could not open": /^stopped: /,
	"plan fault": /^stopped: /,
	"draft PR left open with findings": "review the draft PR (open findings)",
	"delivered, stamp required": "review the delivery",
	"PR follow-up paused": "resume PR follow-up",
	"proposed rule": "review a proposed rule",
	"PR follow-up stopped after delivery": /^stopped: /,
	"flagged delivery whose PR follow-up stopped": /^stopped: /,
};

/** The waiting phrase of the fixtures that wait on someone to start or revise them. */
const WAITING: Record<string, string> = {
	"held before scoping": "on hold",
	"plan that cannot be approved": "plan needs revising",
	"manual card not started": "not started",
};

describe("factory_status agrees with factoryCardState", () => {
	it("covers every fixture", () => {
		expect(Object.keys(TOOL).sort()).toEqual(
			FACTORY_CARD_FIXTURES.map((fixture) => fixture.name).sort(),
		);
	});

	it.each(
		FACTORY_CARD_FIXTURES.map((fixture) => [fixture.name, fixture] as const),
	)("%s", (name, fixture) => {
		const { task, run, working } = fixture;
		const queue = {
			paused: false,
			concurrency: 2,
			working: working ? [task.taskId] : [],
			queued: task.factoryQueued
				? [{ taskId: task.taskId, stage: task.factoryQueued }]
				: [],
		};
		const card = describeFactoryCard(task, run ? [run] : [], queue);
		const state = factoryCardState({
			task,
			lastRun: run,
			planApprovable:
				task.status === "pending_approval" && task.factory
					? factoryPlanApprovalBlocker({ ...task, factory: task.factory }) ===
						null
					: undefined,
			live: {
				designLive: Boolean(working) && task.status === "pending_approval",
				runLive: Boolean(working) && task.status !== "pending_approval",
			},
		});
		expect(state).toMatchObject(fixture.card);
		const [stage, next] = TOOL[name] ?? [];
		expect(card.stage).toBe(stage);
		if (next instanceof RegExp) expect(card.next).toMatch(next);
		else expect(card.next).toBe(next);
		// The tool asks a person for something only when the card waits on one.
		const asks = /^(?:Waits\b|Stays stopped until someone)/.test(card.next);
		expect(asks).toBe(
			state.waitingOn === "person" ||
				state.waitingOn === "start" ||
				state.reasonCode === "draft_pr_ready",
		);
		// needsYou is exactly the cards the desktop's Needs you holds.
		expect(Boolean(card.needsYou)).toBe(state.waitingOn === "person");
		const phrase = NEEDS_YOU[name];
		if (phrase instanceof RegExp) expect(card.needsYou?.reason).toMatch(phrase);
		else expect(card.needsYou?.reason).toBe(phrase);
		// Waiting on a start is never a request for the user's decision.
		expect(card.waiting).toBe(WAITING[name]);
		expect(Boolean(card.needsYou && card.waiting)).toBe(false);
		// A stop's reason is shown; nothing else carries one.
		expect(Boolean(card.lastError)).toBe(
			(state.kind === "stopped" || state.kind === "closed") &&
				Boolean(task.error || run?.factory?.error || run?.error),
		);
	});
});

describe("factory_status lists Needs you in the board's order", () => {
	it("for every fixture on one board", async () => {
		const fixtures = FACTORY_BOARD_FIXTURES.filter(
			(fixture) => !fixture.task.archivedAt,
		);
		const tasks = fixtures.map((fixture) => fixture.task);
		const tool = createFactoryStatusTool({
			manager: {
				listTasks: async () => tasks,
				getTask: async (taskId: string) =>
					tasks.find((task) => task.taskId === taskId),
				getTaskRuns: (taskId: string) =>
					fixtures.flatMap((fixture) =>
						fixture.run && fixture.task.taskId === taskId ? [fixture.run] : [],
					),
				getFactoryQueueState: () => ({
					paused: false,
					concurrency: 2,
					working: fixtures
						.filter((fixture) => fixture.working)
						.map((fixture) => fixture.task.taskId),
					queued: fixtures.flatMap((fixture) =>
						fixture.task.factoryQueued
							? [
									{
										taskId: fixture.task.taskId,
										stage: fixture.task.factoryQueued,
									},
								]
							: [],
					),
				}),
				holdFactoryTask: async () => {
					throw new Error("not used");
				},
				queueFactoryScoping: async () => {
					throw new Error("not used");
				},
				startFactoryQueue: async () => {},
			},
			// Any existing directory: the fake manager lists every fixture.
			resolveSessionDefaults: async () => ({ workspaceRoot: "/" }),
		});
		const result = await tool.execute({} as never, {
			agentId: "chat-agent",
			iteration: 1,
			sessionId: "chat-1",
		});
		if (!result.ok) throw new Error(result.error.message);
		const names = new Map(
			fixtures.map((fixture) => [
				`F${fixture.task.factoryNumber}`,
				fixture.name,
			]),
		);
		expect(result.needsYou?.cards.map((card) => names.get(card.id))).toEqual(
			FACTORY_NEEDS_YOU_ORDER,
		);
	});
});
