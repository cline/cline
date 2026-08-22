import { describe, expect, it } from "vitest";
import { createRunId, createSessionId } from "./ids";
import {
	assertRunStateTransition,
	canTransitionRunState,
	canTransitionSessionState,
	isTerminalRunState,
	RUN_STATE_TRANSITIONS,
	RUN_STATES,
	RunAcceptedSchema,
	RunStateTransitionError,
	SESSION_STATES,
	TERMINAL_RUN_STATES,
} from "./run-states";

describe("run state machine", () => {
	it("covers every state in the transition table", () => {
		expect(Object.keys(RUN_STATE_TRANSITIONS).sort()).toEqual(
			[...RUN_STATES].sort(),
		);
	});

	it("only allows the documented transitions (full matrix)", () => {
		for (const from of RUN_STATES) {
			for (const to of RUN_STATES) {
				const allowed = RUN_STATE_TRANSITIONS[from].includes(to);
				expect(canTransitionRunState(from, to)).toBe(allowed);
			}
		}
	});

	it("queued runs may start or be aborted, never complete directly", () => {
		expect(canTransitionRunState("queued", "running")).toBe(true);
		expect(canTransitionRunState("queued", "aborted")).toBe(true);
		expect(canTransitionRunState("queued", "completed")).toBe(false);
		expect(canTransitionRunState("queued", "interrupted")).toBe(false);
	});

	it("terminal states admit no transitions, including self-loops", () => {
		for (const state of TERMINAL_RUN_STATES) {
			expect(isTerminalRunState(state)).toBe(true);
			for (const to of RUN_STATES) {
				expect(canTransitionRunState(state, to)).toBe(false);
			}
		}
		expect(isTerminalRunState("queued")).toBe(false);
		expect(isTerminalRunState("running")).toBe(false);
	});

	it("assertRunStateTransition throws a typed error carrying a wire error", () => {
		expect(() => assertRunStateTransition("queued", "running")).not.toThrow();
		try {
			assertRunStateTransition("completed", "running");
			expect.unreachable("transition should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(RunStateTransitionError);
			expect((error as RunStateTransitionError).gatewayError.code).toBe(
				"invalid_state_transition",
			);
		}
	});
});

describe("run admission ack", () => {
	it("acks with runId, acceptedAt, and queuePosition", () => {
		const ack = RunAcceptedSchema.parse({
			runId: createRunId(),
			acceptedAt: Date.now(),
			queuePosition: 0,
		});
		expect(ack.queuePosition).toBe(0);
	});

	it("rejects non-run IDs and negative queue positions", () => {
		expect(() =>
			RunAcceptedSchema.parse({
				runId: createSessionId(),
				acceptedAt: Date.now(),
				queuePosition: 0,
			}),
		).toThrow();
		expect(() =>
			RunAcceptedSchema.parse({
				runId: createRunId(),
				acceptedAt: Date.now(),
				queuePosition: -1,
			}),
		).toThrow();
	});
});

describe("session state machine", () => {
	it("sessions only move from active to closed", () => {
		for (const from of SESSION_STATES) {
			for (const to of SESSION_STATES) {
				expect(canTransitionSessionState(from, to)).toBe(
					from === "active" && to === "closed",
				);
			}
		}
	});
});
