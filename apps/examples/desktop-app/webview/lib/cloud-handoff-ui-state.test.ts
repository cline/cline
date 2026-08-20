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

	it("carries the cloud instruction from progress into the target session", () => {
		const started = cloudHandoffUiReducer(
			{},
			{
				type: "start",
				sourceSessionId: "local-1",
				pendingPrompt: {
					content: "continue in cloud",
					submittedAt: 100,
					occurrence: 1,
				},
			},
		);
		const withImage = cloudHandoffUiReducer(started, {
			type: "prompt_images",
			sourceSessionId: "local-1",
			images: [
				{
					id: "handoff-image-1",
					mediaType: "image/png",
					data: "aGVsbG8=",
				},
			],
		});
		const provisioning = cloudHandoffUiReducer(withImage, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "provisioning",
		});
		const existing = [];
		const displayed = appendPendingHandoffPrompt(
			existing,
			"local-1",
			provisioning["local-1"],
		);
		expect(displayed).toHaveLength(1);
		expect(displayed[0]).toMatchObject({
			role: "user",
			content: "continue in cloud",
			createdAt: 100,
			images: [
				expect.objectContaining({
					id: "handoff-image-1",
					mediaType: "image/png",
				}),
			],
			meta: { userRunSpan: 0 },
		});
		const completed = cloudHandoffUiReducer(provisioning, {
			type: "complete",
			sourceSessionId: "local-1",
			receipt: {
				targetSessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
			externalPresentation: false,
		});
		expect(
			appendPendingHandoffPrompt([], "cloud-1", completed["cloud-1"])[0],
		).toMatchObject({ content: "continue in cloud" });

		const canonical = [{ ...displayed[0], id: "canonical-user" }];
		expect(
			appendPendingHandoffPrompt(canonical, "cloud-1", completed["cloud-1"]),
		).toBe(canonical);
		expect(
			cloudHandoffUiReducer(completed, {
				type: "prompt_reconciled",
				sourceSessionId: "cloud-1",
			})["cloud-1"],
		).toBeUndefined();

		const failed = cloudHandoffUiReducer(provisioning, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: false,
		});
		expect(
			appendPendingHandoffPrompt(existing, "local-1", failed["local-1"]),
		).toBe(existing);
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
});
