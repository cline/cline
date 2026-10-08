import { describe, expect, it } from "vitest";
import {
	cloudHandoffUiReducer,
	hasLivePendingHandoff,
	resolveHandoffReceipt,
} from "./cloud-handoff-ui-state";

const RECEIPT = {
	targetSessionId: "cloud-1",
	dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
};
const COMPLETE = {
	type: "complete" as const,
	sourceSessionId: "local-1",
	receipt: RECEIPT,
	externalPresentation: false,
};

describe("cloudHandoffUiReducer", () => {
	it("recognizes live recovery ownership before history refreshes", () => {
		expect(
			hasLivePendingHandoff({
				status: "recovery",
				dashboardUrl: "https://app.cline.bot/agents/cloud-1",
			}),
		).toBe(true);
		expect(
			hasLivePendingHandoff({
				status: "retry_restored",
				dashboardUrl: "https://app.cline.bot/agents/cloud-1",
			}),
		).toBe(true);
		expect(hasLivePendingHandoff({ status: "retry_restored" })).toBe(false);
		expect(hasLivePendingHandoff({ status: "failed" })).toBe(false);
	});

	it("keeps a persisted completion receipt alongside live recovery state", () => {
		const persisted = {
			targetSessionId: "cloud-1",
			dashboardUrl: "https://app.cline.bot/agents/cloud-1",
		};
		expect(
			resolveHandoffReceipt(
				{
					status: "recovery",
					dashboardUrl: persisted.dashboardUrl,
					retryDraft: "/cloud continue",
				},
				persisted,
			),
		).toBe(persisted);
		expect(resolveHandoffReceipt(undefined, persisted)).toBe(persisted);
	});

	it("clears a live recovery override after its payload reaches the target", () => {
		const recovery = {
			"local-1": {
				status: "recovery" as const,
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				retryDraft: "/cloud continue",
				retryAttachments: [
					new File(["image"], "diagram.png", { type: "image/png" }),
				],
			},
		};

		expect(
			cloudHandoffUiReducer(recovery, {
				type: "retry_delivered",
				sourceSessionId: "local-1",
				retryDraft: recovery["local-1"].retryDraft,
				retryAttachments: recovery["local-1"].retryAttachments,
			}),
		).toEqual({});
		for (const delivered of [
			{ ...recovery["local-1"], retryDraft: "/cloud older command" },
			{ ...recovery["local-1"], retryAttachments: [] },
		]) {
			expect(
				cloudHandoffUiReducer(recovery, {
					type: "retry_delivered",
					sourceSessionId: "local-1",
					retryDraft: delivered.retryDraft,
					retryAttachments: delivered.retryAttachments,
				}),
			).toBe(recovery);
		}
	});

	it("preserves the source's latest progress phase", () => {
		const creating = cloudHandoffUiReducer(
			{},
			{
				type: "progress",
				sourceSessionId: "local-1",
				phase: "creating",
			},
		);
		const provisioning = cloudHandoffUiReducer(creating, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "provisioning",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(provisioning["local-1"]).toMatchObject({
			status: "progress",
			phase: "provisioning",
		});
	});

	it("turns failed external progress into recovery without exposing in-app URLs", () => {
		const progress = cloudHandoffUiReducer(
			{},
			{
				type: "progress",
				sourceSessionId: "local-1",
				phase: "verifying",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
		);
		const recovery = cloudHandoffUiReducer(progress, {
			type: "failed",
			sourceSessionId: "local-1",
			retryDraft: "/cloud continue",
		});
		expect(recovery["local-1"]).toEqual({
			status: "recovery",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			retryDraft: "/cloud continue",
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(recovery, {
				type: "retry_restored",
				sourceSessionId: "local-1",
			})["local-1"],
		).toEqual({
			status: "retry_restored",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			retryDraft: "/cloud continue",
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(recovery, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "seeding",
			}),
		).toBe(recovery);
		const failed = cloudHandoffUiReducer(
			{},
			{
				type: "failed",
				sourceSessionId: "local-1",
			},
		);
		expect(
			cloudHandoffUiReducer(failed, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "seeding",
			}),
		).toBe(failed);
		const restored = cloudHandoffUiReducer(failed, {
			type: "retry_restored",
			sourceSessionId: "local-1",
		});
		expect(restored["local-1"]).toEqual({
			status: "retry_restored",
			retryDraft: undefined,
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(restored, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "seeding",
			}),
		).toBe(restored);
	});

	it.each([
		"failed",
		"retry_restored",
	] as const)("consumes %s draft and images after a local send", (status) => {
		const state = {
			"local-1": {
				status,
				retryDraft: "/cloud describe",
				retryAttachments: [new File(["image"], "qa.png")],
			},
		};
		expect(
			cloudHandoffUiReducer(state, {
				type: "local_prompt_delivered",
				sourceSessionId: "local-1",
			}),
		).toEqual({});
	});

	it.each([
		{ status: "progress" as const, phase: "creating" as const },
		{
			status: "recovery" as const,
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		},
		{
			status: "retry_restored" as const,
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			retryDraft: "/cloud describe",
		},
		{
			status: "complete" as const,
			receipt: RECEIPT,
			externalPresentation: false,
		},
	])("retains $status ownership state after a stale local send", (entry) => {
		const state = { "local-1": entry };
		expect(
			cloudHandoffUiReducer(state, {
				type: "local_prompt_delivered",
				sourceSessionId: "local-1",
			}),
		).toBe(state);
	});

	it("lets an explicit retry replace recovery while ignoring late old progress", () => {
		const recovery = {
			"local-1": {
				status: "recovery" as const,
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
		};
		expect(
			cloudHandoffUiReducer(recovery, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "seeding",
			}),
		).toBe(recovery);

		const retry = cloudHandoffUiReducer(recovery, {
			type: "start",
			sourceSessionId: "local-1",
		});
		expect(retry["local-1"]).toEqual({
			status: "progress",
			phase: "checking",
			// A retry keeps the recovery URL so an early failure cannot drop
			// the only dashboard link held in live state.
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
	});

	it("keeps the completion receipt when a late failure lands after complete", () => {
		const completed = cloudHandoffUiReducer({}, COMPLETE);
		const retryAttachments = [new File(["edited"], "edited.png")];

		expect(Object.keys(completed)).toEqual(["local-1"]);
		const withRecovery = cloudHandoffUiReducer(completed, {
			type: "failed",
			sourceSessionId: "local-1",
			retryDraft: "/cloud continue",
			retryAttachments,
		});
		expect(withRecovery["local-1"]).toMatchObject({
			status: "complete",
			receipt: RECEIPT,
			retryDraft: "continue",
			retryAttachments,
		});
		expect(
			cloudHandoffUiReducer(completed, {
				type: "failed",
				sourceSessionId: "local-1",
			}),
		).toBe(completed);
		expect(completed["local-1"]).toEqual({
			status: "complete",
			receipt: RECEIPT,
			externalPresentation: false,
		});
	});

	it.each([
		{ status: "recovery" as const },
		{
			status: "retry_restored" as const,
			retryDraft: "/cloud continue",
			retryAttachments: [
				new File(["image"], "diagram.png", { type: "image/png" }),
			],
		},
	])("dismisses $status without losing its payload or accepting late progress", (entry) => {
		const recovery = {
			"local-1": {
				...entry,
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
		};
		const dismissed = cloudHandoffUiReducer(recovery, {
			type: "dismiss_recovery",
			sourceSessionId: "local-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(dismissed["local-1"]).toEqual({
			...entry,
			status: "recovery_dismissed",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(
			cloudHandoffUiReducer(dismissed, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "seeding",
			}),
		).toBe(dismissed);
		expect(
			cloudHandoffUiReducer(dismissed, {
				type: "start",
				sourceSessionId: "local-1",
			})["local-1"],
		).toEqual({
			status: "progress",
			phase: "checking",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
	});

	it("ignores a stale recovery dismissal after completion", () => {
		const completed = cloudHandoffUiReducer({}, COMPLETE);

		expect(
			cloudHandoffUiReducer(completed, {
				type: "dismiss_recovery",
				sourceSessionId: "local-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			}),
		).toBe(completed);
	});

	it("keeps the recovery URL when retrying an automatically restored draft", () => {
		const restored = cloudHandoffUiReducer(
			{
				"local-1": {
					status: "recovery",
					dashboardUrl: RECEIPT.dashboardUrl,
					retryDraft: "/cloud continue",
				},
			},
			{ type: "retry_restored", sourceSessionId: "local-1" },
		);
		const retry = cloudHandoffUiReducer(restored, {
			type: "start",
			sourceSessionId: "local-1",
		});
		expect(retry["local-1"]).toMatchObject({
			status: "progress",
			dashboardUrl: RECEIPT.dashboardUrl,
		});
	});
});
