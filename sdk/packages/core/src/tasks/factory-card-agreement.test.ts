/**
 * The status tool's words agree with factoryCardState for every shared card
 * fixture. The desktop checks its stage line, Needs you and card header
 * against the same fixtures (webview/lib/factory-card-agreement.test.tsx).
 */
import { factoryCardState, factoryPlanApprovalBlocker } from "@cline/shared";
import { describe, expect, it } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the card fixtures are shared test data, not part of @cline/shared's published entrypoints
import { FACTORY_CARD_FIXTURES } from "../../../shared/src/__tests__/factory-card-fixtures";
import { describeFactoryCard, type FactoryStage } from "./factory-tool";

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
		/: its plan reviewers still had findings/,
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
		// A stop's reason is shown; nothing else carries one.
		expect(Boolean(card.lastError)).toBe(
			(state.kind === "stopped" || state.kind === "closed") &&
				Boolean(task.error || run?.factory?.error || run?.error),
		);
	});
});
