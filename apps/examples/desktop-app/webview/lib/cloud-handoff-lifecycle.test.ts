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
	destination: "in_app" as const,
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
	const start = () => {
		const id = lifecycle.onRpcStarted("local");
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
	it("keeps the source open and retains the target link through sending and duplicate completion", async () => {
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
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId,
			result,
			nextCommand: "continue",
			sourceAttachments: [],
		});
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			dashboardUrl: result.dashboardUrl,
		});
	});
	it("restores preparation failures with images, but never restores /cloud after a known target", async () => {
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
	it("ignores stale completion and allows another deliberate cloud task", async () => {
		const h = harness();
		const old = h.start();
		const newer = h.start();
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId: old,
			phase: "complete",
		});
		expect(h.state().local).toEqual({ status: "progress", phase: "checking" });
		await h.lifecycle.onEvent({
			...result,
			handoffAttemptId: newer,
			phase: "complete",
		});
		await h.lifecycle.onEvent({
			...result,
			sessionId: "cloud-2",
			handoffAttemptId: h.start(),
			phase: "complete",
		});
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud-2",
		});
	});
	it("keeps navigation in the current view and surfaces delivery uncertainty", async () => {
		const h = harness();
		await h.lifecycle.onRpcResolved("local", {
			handoffAttemptId: h.start(),
			result: {
				...result,
				warning: "Check the task before resending.",
				warningKind: "unconfirmed",
			},
			nextCommand: "continue",
			sourceAttachments: [],
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({ variant: "destructive" }),
		);
		expect(h.state().local).toMatchObject({
			status: "complete",
			sessionId: "cloud",
			message: "Check the task before resending.",
		});
	});
});
