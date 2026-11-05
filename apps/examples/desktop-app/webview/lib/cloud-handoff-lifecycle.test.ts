import { describe, expect, it, vi } from "vitest";
import { createHandoffLifecycle } from "./cloud-handoff-lifecycle";
import {
	type CloudHandoffUiAction,
	type CloudHandoffUiState,
	cloudHandoffUiReducer,
} from "./cloud-handoff-ui-state";

const result = {
	sourceSessionId: "local",
	sessionId: "cloud",
	dashboardUrl: "https://app.cline.bot/agents/cloud",
};
function harness(isSourceVisible: (source: string) => boolean = () => false) {
	let state: CloudHandoffUiState = {};
	const dispatch = vi.fn((action: CloudHandoffUiAction) => {
		state = cloudHandoffUiReducer(state, action);
	});
	const toast = vi.fn();
	const dismissConfirmation = vi.fn();
	const lifecycle = createHandoffLifecycle({
		dispatch,
		toast,
		dismissConfirmation,
		isSourceVisible,
	});
	const start = (attachments: File[] = []) => {
		const id = lifecycle.onRpcStarted("local", attachments);
		dispatch({ type: "start", sourceSessionId: "local" });
		return id;
	};
	return {
		lifecycle,
		toast,
		dismissConfirmation,
		start,
		state: () => state,
	};
}

describe("summary handoff lifecycle", () => {
	it.each([
		true,
		false,
	])("keeps the GitHub action in recovery and only toasts in the background (visible=%s)", async (visible) => {
		const h = harness((source) => visible && source === "local");
		const connectUrl = "https://app.cline.bot/settings/github";
		const attachments = [new File(["image"], "image.png")];
		const failure = {
			error: new Error(
				`CLOUD_SESSION_ERROR:${JSON.stringify({ code: "github_not_connected", message: "Connect GitHub to continue.", connectUrl })}`,
			),
			nextCommand: "Continue",
			sourceAttachments: attachments,
		};
		h.lifecycle.onPreparationStarted("local");
		h.lifecycle.onPreparationRejected("local", failure);
		expect(h.state().local).toMatchObject({
			status: "failed",
			connectUrl,
			retryDraft: "Continue",
			retryAttachments: attachments,
			preparationFailure: { connectUrl },
		});
		expect(h.toast.mock.calls).toEqual(
			visible
				? []
				: [
						[
							{
								title: "Cloud preparation failed",
								description: "Connect GitHub to continue.",
								variant: "destructive",
								connectUrl,
							},
						],
					],
		);
		h.toast.mockClear();
		const handoffAttemptId = h.start(attachments);
		await h.lifecycle.onRpcRejected("local", { ...failure, handoffAttemptId });
		expect(h.state().local).toMatchObject({
			status: "failed",
			connectUrl,
			retryDraft: "Continue",
			retryAttachments: attachments,
		});
		expect(h.toast.mock.calls).toEqual(
			visible
				? []
				: [
						[
							{
								title: "Cloud request needs attention",
								description: "Connect GitHub to continue.",
								variant: "destructive",
								connectUrl,
							},
						],
					],
		);
	});
	it.each([
		"provisioning",
		"complete",
	] as const)("clears %s links on account change and ignores late results", async (phase) => {
		const h = harness();
		const handoffAttemptId = h.start();
		await h.lifecycle.onEvent({ ...result, handoffAttemptId, phase });
		const preparation = h.lifecycle.onPreparationStarted("local");
		h.lifecycle.reset();
		expect(h.dismissConfirmation).toHaveBeenCalledOnce();
		expect(preparation?.aborted).toBe(true);
		expect(h.state()).toEqual({});
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId,
			phase: "complete",
		});
		await h.lifecycle.onRpcResolved("local", { handoffAttemptId, result });
		await h.lifecycle.onRpcRejected("local", {
			handoffAttemptId,
			error: new Error("Viewer disposed"),
			nextCommand: "Continue",
			sourceAttachments: [],
		});
		expect(h.state()).toEqual({});
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.lifecycle.onPreparationStarted("local")?.aborted).toBe(false);
	});
	it("keeps the draft and warns to check cloud tasks when submission has no known target", async () => {
		const h = harness();
		const attachments = [new File(["image"], "image.png")];
		const handoffAttemptId = h.start(attachments);
		const message =
			"The cloud task may have started. Check your cloud tasks before submitting this draft again.";
		await h.lifecycle.onRpcRejected("local", {
			handoffAttemptId,
			error: new Error(
				`CLOUD_SESSION_ERROR:${JSON.stringify({ code: "request_failed", message })}`,
			),
			nextCommand: "Continue",
			sourceAttachments: attachments,
		});
		expect(h.state().local).toMatchObject({
			status: "failed",
			message,
			retryDraft: "Continue",
			retryAttachments: attachments,
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Cloud request needs attention",
				description: message,
			}),
		);
	});
	it.each([
		false,
		true,
	])("recovers A without substituting B's files (reload=%s)", async (reload) => {
		const h = harness();
		const aFiles = [new File(["a"], "a.png")];
		const bFiles = [new File(["b"], "b.png")];
		const id = reload ? "previous-window" : h.start(aFiles);
		if (!reload)
			await h.lifecycle.onRpcRejected("local", {
				handoffAttemptId: id,
				error: new Error("Connection closed"),
				nextCommand: "A",
				sourceAttachments: aFiles,
			});
		expect(h.lifecycle.getCompletedAttemptId("local")).toBeUndefined();
		expect(h.lifecycle.onPreparationStarted("local")?.aborted).toBe(false);
		h.lifecycle.onPreparationRejected("local", {
			error: new Error("Check the existing task"),
			nextCommand: "B",
			sourceAttachments: bFiles,
			silent: true,
		});
		h.lifecycle.onRecovered("local", {
			handoffAttemptId: id,
			result: { ...result, warningKind: "unqueued", unsentPrompt: "Summary A" },
		});
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			unsentDraft: reload
				? undefined
				: { text: "Summary A", attachments: aFiles },
			preparationFailure: { draft: { text: "B", attachments: bFiles } },
		});
		if (reload)
			expect(h.state().local.message).toContain("Check the cloud conversation");
		expect(h.lifecycle.getCompletedAttemptId("local")).toBe(id);
		expect(h.lifecycle.onPreparationStarted("local")?.aborted).toBe(false);
	});
	it.each([
		"before",
		"after",
	])("keeps A's completion when B's preview fails %s it", async (order) => {
		const h = harness();
		const aFiles = [new File(["a"], "a.png")];
		const bFiles = [new File(["b"], "b.png")];
		const handoffAttemptId = h.start(aFiles);
		await h.lifecycle.onRpcRejected("local", {
			handoffAttemptId,
			error: new Error("Connection lost"),
			nextCommand: "A",
			sourceAttachments: aFiles,
		});
		expect(h.lifecycle.onPreparationStarted("local")?.aborted).toBe(false);
		const complete = () =>
			h.lifecycle.onEvent({
				...result,
				handoffAttemptId,
				phase: "complete",
				warningKind: "unqueued",
				unsentPrompt: "Summary A",
			});
		if (order === "after") await complete();
		expect(h.lifecycle.onPreparationStarted("local")).toBeUndefined();
		h.lifecycle.onPreparationRejected("local", {
			error: new Error("Preparation already in progress"),
			nextCommand: "Edited B",
			sourceAttachments: bFiles,
		});
		if (order === "before") await complete();
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			unsentDraft: { text: "Summary A", attachments: aFiles },
			preparationFailure: { draft: { text: "Edited B", attachments: bFiles } },
		});
		expect(h.lifecycle.onPreparationStarted("local")?.aborted).toBe(false);
		const newer = h.start(bFiles);
		const pending = h.state();
		await complete();
		expect(h.state()).toBe(pending);
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId: newer,
			phase: "complete",
			warningKind: "unqueued",
			unsentPrompt: "Summary B",
		});
		expect(h.state().local).toMatchObject({
			unsentDraft: { text: "Summary B", attachments: bFiles },
		});
		expect(h.state().local.preparationFailure).toBeUndefined();
	});
	it("keeps an unsent prepared prompt and images when completion arrives before the RPC", async () => {
		const h = harness();
		const attachments = [
			new File(["image"], "image.png", { type: "image/png" }),
		];
		const handoffAttemptId = h.start(attachments);
		const failed = {
			...result,
			warningKind: "unqueued" as const,
			warning: "Not sent",
			unsentPrompt: "Summary and instruction",
		};
		await h.lifecycle.onEvent({
			...failed,
			handoffAttemptId,
			phase: "complete",
		});
		const completed = h.state();
		expect(completed.local).toMatchObject({
			status: "complete",
			unsentDraft: { text: failed.unsentPrompt, attachments },
		});
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId,
			result: failed,
		});
		expect(h.state()).toBe(completed);
		expect(h.toast).toHaveBeenCalledOnce();
		expect(h.toast).toHaveBeenCalledWith({
			title: "Handoff completed with a warning",
			description: failed.warning,
		});
	});
	it("retains the target link and ignores repeated completion", async () => {
		const h = harness();
		const handoffAttemptId = h.start();
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId,
			phase: "provisioning",
		});
		expect(h.state().local).toMatchObject({
			status: "progress",
			phase: "provisioning",
			sessionId: "cloud",
		});
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId,
			phase: "complete",
			warning: "   ",
		});
		const completed = h.state();
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId,
			result,
		});
		expect(h.state()).toBe(completed);
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			dashboardUrl: result.dashboardUrl,
		});
	});
	it("retains failed input with images, but never offers /cloud again after a known target", async () => {
		const h = harness();
		const attachments = [
			new File(["image"], "shot.png", { type: "image/png" }),
		];
		const ctx = {
			handoffAttemptId: h.start(),
			error: new Error("summary failed"),
			nextCommand: "continue",
			sourceAttachments: attachments,
		};
		await h.lifecycle.onRpcRejected("local", ctx);
		expect(h.state().local).toEqual({
			status: "failed",
			message: "summary failed",
			retryDraft: "continue",
			retryAttachments: attachments,
		});
		ctx.handoffAttemptId = h.start();
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId: ctx.handoffAttemptId,
			phase: "provisioning",
		});
		await h.lifecycle.onRpcRejected("local", ctx);
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
		});
		expect(h.toast).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: "Check the cloud task" }),
		);
	});
	it("shows delivery uncertainty with the cloud link", async () => {
		const h = harness();
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId: h.start(),
			result: {
				...result,
				warning: "Check the task before resending.",
				warningKind: "unconfirmed",
			},
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({ variant: "destructive" }),
		);
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			message: "Check the task before resending.",
			unsentDraft: undefined,
		});
	});
});
