import { describe, expect, it, vi } from "vitest";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { createTurnLifecycle } from "./turn-lifecycle";

function harness() {
	const writes: ChatSessionStatus[] = [];
	const lifecycle = createTurnLifecycle((status) => writes.push(status));
	return { lifecycle, writes, last: () => writes[writes.length - 1] };
}

describe("createTurnLifecycle", () => {
	it("walks a direct turn through starting -> running -> settled", () => {
		const { lifecycle, writes } = harness();
		lifecycle.begin();
		lifecycle.turnStarted();
		lifecycle.settle("completed");
		expect(writes).toEqual(["starting", "running", "completed"]);
	});

	it("drops a hub 'running' projection that would reopen a settled turn", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.turnStarted();
		lifecycle.settle("completed");
		lifecycle.projectStatus("running");
		expect(last()).toBe("completed");
	});

	it("applies a 'running' projection once a new turn has started", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.settle("completed");
		lifecycle.turnStarted();
		lifecycle.projectStatus("running");
		expect(last()).toBe("running");
	});

	it("applies non-busy projections even after settling", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.settle("completed");
		lifecycle.projectStatus("idle");
		expect(last()).toBe("idle");
	});

	it("invalidates tokens when the runtime starts a turn", () => {
		const { lifecycle } = harness();
		const token = lifecycle.begin();
		expect(lifecycle.isCurrent(token)).toBe(true);
		lifecycle.turnStarted();
		expect(lifecycle.isCurrent(token)).toBe(false);
	});

	it("invalidates tokens on queued submissions without touching status", () => {
		const { lifecycle, writes } = harness();
		lifecycle.turnStarted();
		const token = lifecycle.token();
		lifecycle.noteQueuedSubmission();
		expect(lifecycle.isCurrent(token)).toBe(false);
		expect(writes).toEqual(["running"]);
	});

	it("settleIfRunning only settles a running turn", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.turnStarted();
		lifecycle.settle("failed");
		lifecycle.settleIfRunning("completed");
		expect(last()).toBe("failed");

		lifecycle.turnStarted();
		lifecycle.settleIfRunning("completed");
		expect(last()).toBe("completed");
		// And the settle absorbs stale busy signals like a plain settle.
		lifecycle.projectStatus("running");
		expect(last()).toBe("completed");
	});

	it("apply writes without lifecycle semantics", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.settle("completed");
		const token = lifecycle.token();
		lifecycle.apply("stopping");
		// Neither invalidated the token nor lifted the settled absorption.
		expect(lifecycle.isCurrent(token)).toBe(true);
		lifecycle.projectStatus("running");
		expect(last()).toBe("stopping");
	});

	it("reset starts a fresh era: tokens stale, absorption lifted", () => {
		const { lifecycle, last } = harness();
		lifecycle.begin();
		lifecycle.settle("completed");
		const token = lifecycle.token();
		lifecycle.reset("idle");
		expect(lifecycle.isCurrent(token)).toBe(false);
		lifecycle.projectStatus("running");
		expect(last()).toBe("running");
	});

	it("notifies the status callback for every write", () => {
		const onStatusChange = vi.fn();
		const lifecycle = createTurnLifecycle(onStatusChange);
		lifecycle.begin();
		lifecycle.projectStatus("running");
		lifecycle.settle("cancelled");
		expect(onStatusChange.mock.calls.map(([s]) => s)).toEqual([
			"starting",
			"running",
			"cancelled",
		]);
	});
});
