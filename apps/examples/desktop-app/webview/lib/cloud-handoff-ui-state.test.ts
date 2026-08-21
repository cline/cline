import { describe, expect, it } from "vitest";
import {
	appendPendingHandoffPrompt,
	cloudHandoffUiReducer,
} from "./cloud-handoff-ui-state";

describe("cloudHandoffUiReducer", () => {
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
			status: "recovery",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
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
		expect(restored["local-1"]).toEqual({ status: "retry_restored" });
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
		});
	});

	it("reconciles an authoritative late completion after a webview failure", () => {
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
		).toEqual({ status: "progress", phase: "checking" });
	});

	it("keeps the temporary handoff prompt ahead of a live response", () => {
		const prompt = {
			content: "hey cloud what do you see",
			submittedAt: 100,
			baselineOccurrences: 1,
			images: [
				{
					id: "handoff-image",
					mediaType: "image/png",
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
			createdAt: 120,
		};
		const priorPrompt = {
			id: "prior-user",
			sessionId: "cloud-1",
			role: "user" as const,
			content: prompt.content,
			createdAt: 50,
		};
		const displayed = appendPendingHandoffPrompt(
			[priorPrompt, liveResponse],
			"cloud-1",
			completed["cloud-1"],
		);
		expect(displayed.map((message) => message.role)).toEqual([
			"user",
			"user",
			"assistant",
		]);
		expect(displayed[1]).toMatchObject({
			content: prompt.content,
			images: prompt.images,
		});

		const canonical = {
			...displayed[1],
			id: "canonical-user",
			content: `<user_input mode="act">${prompt.content}</user_input>`,
			createdAt: 90,
		};
		expect(
			appendPendingHandoffPrompt(
				[priorPrompt, canonical, liveResponse],
				"cloud-1",
				completed["cloud-1"],
			),
		).toEqual([priorPrompt, canonical, liveResponse]);
	});
});
