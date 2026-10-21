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
function harness() {
	let state: CloudHandoffUiState = {};
	const dispatch = vi.fn((action: CloudHandoffUiAction) => {
		state = cloudHandoffUiReducer(state, action);
	});
	const toast = vi.fn();
	const lifecycle = createHandoffLifecycle({
		dispatch,
		toast,
	});
	const start = (attachments: File[] = []) => {
		const id = lifecycle.onRpcStarted("local", attachments);
		dispatch({ type: "start", sourceSessionId: "local" });
		return id;
	};
	return {
		lifecycle,
		toast,
		start,
		state: () => state,
	};
}

describe("summary handoff lifecycle", () => {
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
		expect(h.lifecycle.onPreparationStarted("local")).toBe(true);
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
			unsentDraft: { text: "Summary A", attachments: reload ? [] : aFiles },
			preparationFailure: { draft: { text: "B", attachments: bFiles } },
		});
		if (reload)
			expect(h.state().local.message).toContain("Reattach any images");
		expect(h.lifecycle.getCompletedAttemptId("local")).toBe(id);
		expect(h.lifecycle.onPreparationStarted("local")).toBe(true);
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
		expect(h.lifecycle.onPreparationStarted("local")).toBe(true);
		const complete = () =>
			h.lifecycle.onEvent({
				...result,
				handoffAttemptId,
				phase: "complete",
				warningKind: "unqueued",
				unsentPrompt: "Summary A",
			});
		if (order === "after") await complete();
		expect(h.lifecycle.onPreparationStarted("local")).toBe(false);
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
		expect(h.lifecycle.onPreparationStarted("local")).toBe(true);
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
	});
	it("retains the target link and ignores repeated completion", async () => {
		const h = harness();
		const handoffAttemptId = h.start();
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId,
			phase: "sending",
		});
		expect(h.state().local).toMatchObject({
			status: "progress",
			phase: "sending",
			sessionId: "cloud",
		});
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId,
			phase: "complete",
		});
		const completed = h.state();
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId,
			result,
		});
		expect(h.state()).toBe(completed);
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
