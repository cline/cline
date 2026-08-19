import { describe, expect, it } from "vitest";
import {
	fixtureConnectedIdle,
	fixtureFailedRun,
	fixtureIncompatible,
	fixtureStreamingRun,
	fixtureUnavailable,
} from "@shared/fixtures";
import { createClientRequestId, planComposer, retryableRun } from "./composer";

describe("composer plan", () => {
	it("creates the first session lazily when the bot has none", () => {
		const plan = planComposer(fixtureConnectedIdle());
		expect(plan.primary).toBe("start_first_session");
		expect(plan.disabledReason).toBeUndefined();
	});

	it("steers by default while a run is active, with queue-next secondary", () => {
		const plan = planComposer(fixtureStreamingRun());
		expect(plan.primary).toBe("steer_active_run");
		expect(plan.secondary).toBe("queue_turn");
		expect(plan.activeRunId).toBe("run_fixture00000001");
	});

	it("queues an ordinary FIFO turn when the session is idle", () => {
		const plan = planComposer(fixtureFailedRun());
		expect(plan.primary).toBe("queue_turn");
	});

	it("disables composing while unavailable or incompatible", () => {
		expect(planComposer(fixtureUnavailable()).disabledReason).toBeDefined();
		expect(planComposer(fixtureIncompatible()).disabledReason).toBeDefined();
	});
});

describe("retryable run detection", () => {
	it("only offers retry when the Gateway marked the run retryable", () => {
		expect(retryableRun(fixtureFailedRun())?.runId).toBe(
			"run_fixture00000001",
		);
		expect(retryableRun(fixtureStreamingRun())).toBeUndefined();
	});
});

describe("client request IDs", () => {
	it("generates unique idempotency-safe IDs", () => {
		const a = createClientRequestId();
		const b = createClientRequestId();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
	});
});
