import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createSessionState, reduceSession, selectViewModel } from "./reducer";

describe("waiting for output uses stream events, not timers or text guesses", () => {
	it("waits before output and between tool/model steps, not while streaming", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		const event = (name: string, payload = {}) => {
			state = reduceSession(state, {
				type: "event",
				envelope: { version: "v1", event: name, payload } as HubEventEnvelope,
			});
			return Boolean(selectViewModel(state).awaitingOutput);
		};
		expect(event("run.started")).toBe(true);
		expect(event("reasoning.delta", { text: "Considering" })).toBe(false);
		expect(event("reasoning.finished", { reasoning: "Considered" })).toBe(true); // No timestamp required.
		expect(event("assistant.delta", { text: "Checking" })).toBe(false);
		expect(event("assistant.finished", { text: "Checking" })).toBe(true);
		expect(
			event("tool.started", {
				toolCallId: "a",
				toolName: "bash",
				input: { command: "pwd" },
			}),
		).toBe(false);
		state = reduceSession(state, {
			type: "user_input",
			text: "Also check tests",
		});
		expect(selectViewModel(state).awaitingOutput).toBeUndefined();
		state = reduceSession(state, { type: "send_queued", messageId: "u1" });
		expect(
			event("tool.finished", {
				toolCallId: "a",
				toolName: "bash",
				output: "/workspace",
			}),
		).toBe(true);
		expect(event("assistant.delta", { text: "Done" })).toBe(false);
		state = reduceSession(state, { type: "user_input", text: "Follow up" });
		expect(selectViewModel(state).awaitingOutput).toBeUndefined();
		expect(event("run.completed")).toBe(false);
		expect(event("run.started")).toBe(true); // Previous assistant answer cannot hide a new wait.
		expect(event("run.failed", { error: "Unavailable" })).toBe(false);
	});
	it("does not show a second waiting indicator during a question or approval", () => {
		const state = { ...createSessionState(), runStatus: "running" as const };
		expect(
			selectViewModel({
				...state,
				pendingQuestions: [{ requestId: "q" } as never],
			}).awaitingOutput,
		).toBeUndefined();
		expect(
			selectViewModel({
				...state,
				pendingApprovals: [{ approvalId: "a" } as never],
			}).awaitingOutput,
		).toBeUndefined();
	});
});
