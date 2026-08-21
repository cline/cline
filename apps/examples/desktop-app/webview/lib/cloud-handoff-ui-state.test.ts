import { describe, expect, it } from "vitest";
import {
	appendPendingHandoffPrompt,
	cloudHandoffUiReducer,
	matchingHandoffPromptMessageIds,
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

	it("does not attribute ambiguous completion progress to an edited retry", () => {
		const oldPrompt = {
			content: "old cloud task",
			submittedAt: 100,
			baselineMessageIds: [],
		};
		const newPrompt = {
			content: "edited cloud task",
			submittedAt: 200,
			baselineMessageIds: [],
		};
		const recovery = {
			"local-1": {
				status: "recovery" as const,
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				pendingPrompt: oldPrompt,
			},
		};
		const retry = cloudHandoffUiReducer(recovery, {
			type: "start",
			sourceSessionId: "local-1",
			pendingPrompt: newPrompt,
		});
		expect(retry["local-1"]).toMatchObject({
			status: "progress",
			phase: "checking",
			pendingPrompt: newPrompt,
			retry: true,
		});
		const rejectedRetry = cloudHandoffUiReducer(retry, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: false,
		});
		expect(rejectedRetry["local-1"]).toMatchObject({
			status: "failed",
			pendingPrompt: newPrompt,
			retry: true,
		});

		const ambiguousCompletion = cloudHandoffUiReducer(rejectedRetry, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "complete",
			sessionId: "cloud-old",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-old",
			destination: "in_app",
		});
		expect(ambiguousCompletion["cloud-old"]).toBeUndefined();

		const retryCompleted = cloudHandoffUiReducer(ambiguousCompletion, {
			type: "complete",
			sourceSessionId: "local-1",
			receipt: {
				targetSessionId: "cloud-new",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-new",
			},
			externalPresentation: false,
			pendingPrompt: newPrompt,
		});
		expect(retryCompleted["cloud-new"]).toEqual({
			status: "target_prompt",
			pendingPrompt: newPrompt,
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
					baselineMessageIds: ["prior-user"],
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
		const existing = [
			{
				id: "prior-user",
				sessionId: "local-1",
				role: "user" as const,
				content: '<user_input mode="act">continue in cloud</user_input>',
				createdAt: 50,
			},
		];
		const displayed = appendPendingHandoffPrompt(
			existing,
			"local-1",
			provisioning["local-1"],
		);
		expect(displayed).toHaveLength(2);
		const preview = displayed.at(-1);
		if (!preview) throw new Error("expected a handoff prompt preview");
		expect(preview).toMatchObject({
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
			pendingPrompt:
				provisioning["local-1"]?.status === "progress"
					? provisioning["local-1"].pendingPrompt
					: undefined,
		});
		const seededPrior = { ...existing[0], id: "prior-canonical" };
		expect(
			appendPendingHandoffPrompt(
				[seededPrior],
				"cloud-1",
				completed["cloud-1"],
			).at(-1),
		).toMatchObject({ content: "continue in cloud" });

		const canonical = [
			seededPrior,
			{
				...preview,
				id: "canonical-user",
				content: '<user_input mode="act">continue in cloud</user_input>',
				createdAt: 110,
			},
		];
		expect(
			appendPendingHandoffPrompt(canonical, "cloud-1", completed["cloud-1"]),
		).toBe(canonical);
		expect(
			cloudHandoffUiReducer(completed, {
				type: "prompt_reconciled",
				sourceSessionId: "cloud-1",
			})["cloud-1"],
		).toBeUndefined();
		expect(
			matchingHandoffPromptMessageIds(
				[
					{
						...canonical[1],
						content:
							'<user_command slash="team">spawn a team of agents for the following task: inspect rpc startup</user_command>',
					},
				],
				"/team inspect rpc startup",
			),
		).toEqual(["canonical-user"]);

		const failed = cloudHandoffUiReducer(provisioning, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: false,
		});
		expect(
			appendPendingHandoffPrompt(existing, "local-1", failed["local-1"]),
		).toBe(existing);
		const restored = cloudHandoffUiReducer(failed, {
			type: "retry_restored",
			sourceSessionId: "local-1",
		});
		const lateCompleted = cloudHandoffUiReducer(restored, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "complete",
			sessionId: "cloud-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			destination: "in_app",
		});
		expect(lateCompleted["cloud-1"]).toMatchObject({
			status: "target_prompt",
		});
		expect(
			cloudHandoffUiReducer(completed, {
				type: "failed",
				sourceSessionId: "local-1",
				exposeRecovery: false,
			}),
		).toBe(completed);
		const externalized = cloudHandoffUiReducer(completed, {
			type: "external",
			sourceSessionId: "local-1",
		});
		expect(
			cloudHandoffUiReducer(externalized, {
				type: "progress",
				sourceSessionId: "local-1",
				phase: "complete",
				sessionId: "cloud-1",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				destination: "in_app",
			})["local-1"],
		).toMatchObject({ externalPresentation: true });
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
