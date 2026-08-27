import { describe, expect, it } from "vitest";
import {
	appendPendingHandoffPrompt,
	cloudHandoffUiReducer,
	resolveHandoffReceipt,
} from "./cloud-handoff-ui-state";

describe("cloudHandoffUiReducer", () => {
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
					retryDraft: "/handoff continue",
				},
				persisted,
			),
		).toBe(persisted);
		expect(resolveHandoffReceipt(undefined, persisted)).toBe(persisted);
	});

	it("carries the event's warningKind into the completed entry", () => {
		const next = cloudHandoffUiReducer(
			{},
			{
				type: "progress",
				sourceSessionId: "local-1",
				phase: "complete",
				sessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				destination: "in_app",
				warningKind: "unqueued",
			},
		);
		expect(next["local-1"]).toMatchObject({
			status: "complete",
			warningKind: "unqueued",
		});
	});

	it("keeps a source locked across pane remounts and preserves its latest phase", () => {
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
			exposeRecovery: true,
			retryDraft: "/handoff continue",
		});
		expect(recovery["local-1"]).toEqual({
			status: "recovery",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			retryDraft: "/handoff continue",
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
			retryDraft: "/handoff continue",
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(progress, {
				type: "failed",
				sourceSessionId: "local-1",
				exposeRecovery: false,
			})["local-1"],
		).toEqual({
			status: "failed",
			retryDraft: undefined,
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(recovery, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "complete",
			}),
		).toBe(recovery);
		const failed = cloudHandoffUiReducer(progress, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: false,
		});
		expect(
			cloudHandoffUiReducer(failed, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "complete",
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
				phase: "complete",
			}),
		).toBe(restored);
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
				phase: "complete",
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

	it("clears same-attempt recovery after a clean authoritative completion", () => {
		const failed = {
			"local-1": {
				status: "failed" as const,
				retryDraft: "/handoff continue",
			},
		};
		const completed = cloudHandoffUiReducer(failed, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "complete",
			sessionId: "cloud-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			destination: "in_app",
		});

		expect(completed["local-1"]).toEqual({
			status: "complete",
			receipt: {
				targetSessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
			externalPresentation: false,
		});
	});

	it("keeps the completion receipt when a late failure lands after complete", () => {
		const completed = cloudHandoffUiReducer(
			{},
			{
				type: "complete",
				sourceSessionId: "local-1",
				receipt: {
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				},
				externalPresentation: false,
			},
		);

		// The RPC transport can fail after the authoritative completion event
		// already landed; the receipt and its cloud URL must survive.
		const withRecovery = cloudHandoffUiReducer(completed, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: true,
			retryDraft: "/handoff continue",
		});
		expect(withRecovery["local-1"]).toMatchObject({
			status: "complete",
			receipt: {
				targetSessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
			retryDraft: "/handoff continue",
		});
		expect(
			cloudHandoffUiReducer(completed, {
				type: "failed",
				sourceSessionId: "local-1",
				exposeRecovery: false,
			}),
		).toBe(completed);
		expect(completed["local-1"]).toEqual({
			status: "complete",
			receipt: {
				targetSessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
			externalPresentation: false,
		});
	});

	it("keeps a completed receipt with recovery payload when its target cannot open", () => {
		const attachment = new File(["img"], "shot.png", {
			type: "image/png",
		});
		const recovered = cloudHandoffUiReducer(
			{
				"local-1": {
					status: "complete",
					receipt: {
						targetSessionId: "cloud-1",
						dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
					},
					externalPresentation: false,
				},
			},
			{
				type: "target_open_failed",
				sourceSessionId: "local-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				retryDraft: "/handoff continue",
				retryAttachments: [attachment],
			},
		);

		expect(recovered["local-1"]).toEqual({
			status: "complete",
			receipt: {
				targetSessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
			externalPresentation: false,
			retryDraft: "/handoff continue",
			retryAttachments: [attachment],
		});
	});

	it("dismisses recovery for this app run without accepting late progress", () => {
		const recovery = {
			"local-1": {
				status: "recovery" as const,
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
		};
		const dismissed = cloudHandoffUiReducer(recovery, {
			type: "dismiss_recovery",
			sourceSessionId: "local-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(dismissed["local-1"]).toEqual({
			status: "recovery_dismissed",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(
			cloudHandoffUiReducer(dismissed, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "complete",
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

	it("keeps the temporary handoff prompt ahead of a live response", () => {
		const prompt = {
			content: "hey cloud what do you see",
			submittedAt: 100,
			baselineOccurrences: 1,
			baselineTailMessageId: "seed-tail",
			images: [
				{
					id: "handoff-image",
					mediaType: "image/png" as const,
					data: "aGVsbG8=",
				},
			],
		};
		const completed = cloudHandoffUiReducer(
			{},
			{
				type: "complete",
				sourceSessionId: "local-1",
				receipt: {
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				},
				externalPresentation: false,
				pendingPrompt: prompt,
			},
		);
		const liveResponse = {
			id: "assistant-live",
			sessionId: "cloud-1",
			role: "assistant" as const,
			content: "I see a robot",
			createdAt: 90,
		};
		const priorPrompt = {
			id: "prior-user",
			sessionId: "cloud-1",
			role: "user" as const,
			content: prompt.content,
			createdAt: 50,
		};
		const seedTail = {
			id: prompt.baselineTailMessageId,
			sessionId: "cloud-1",
			role: "assistant" as const,
			content: "Previous local response",
			createdAt: 75,
		};
		const displayed = appendPendingHandoffPrompt(
			[priorPrompt, seedTail, liveResponse],
			"cloud-1",
			completed["cloud-1"],
		);
		expect(displayed.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		expect(displayed[2]).toMatchObject({
			content: prompt.content,
			images: prompt.images,
		});
		const laterSamePrompt = {
			id: "user_optimistic-later",
			sessionId: "cloud-1",
			role: "user" as const,
			content: prompt.content,
			createdAt: 110,
		};
		expect(
			appendPendingHandoffPrompt(
				[priorPrompt, seedTail, laterSamePrompt, liveResponse],
				"cloud-1",
				completed["cloud-1"],
			),
		).toEqual([
			priorPrompt,
			seedTail,
			displayed[2],
			laterSamePrompt,
			liveResponse,
		]);

		const canonical = {
			...displayed[2],
			id: "canonical-user",
			content: `<user_input mode="act">${prompt.content}</user_input>`,
			createdAt: 80,
		};
		expect(
			appendPendingHandoffPrompt(
				[priorPrompt, seedTail, canonical, liveResponse],
				"cloud-1",
				completed["cloud-1"],
			),
		).toEqual([priorPrompt, seedTail, canonical, liveResponse]);
	});
});
