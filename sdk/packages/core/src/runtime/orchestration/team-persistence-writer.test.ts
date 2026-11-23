import { TeamMessageType } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamEvent } from "../../extensions/tools/team";
import type { TeamPersistenceBatch } from "../../types/storage";
import {
	type TeamPersistenceSource,
	TeamPersistenceWriter,
} from "./team-persistence-writer";

const run = {
	id: "run_1",
	agentId: "a",
	status: "running" as const,
	message: "m",
	priority: 0,
	retryCount: 0,
	maxRetries: 0,
	startedAt: new Date(),
};
const chunk = {
	type: TeamMessageType.AgentEvent,
	agentId: "a",
	event: { type: "content_update" },
} as unknown as TeamEvent;
const heartbeat: TeamEvent = {
	type: TeamMessageType.RunProgress,
	run,
	message: "heartbeat",
};
const taskUpdated: TeamEvent = {
	type: TeamMessageType.TeamTaskUpdated,
	task: {
		id: "task_1",
		title: "t",
		description: "d",
		status: "pending",
		createdAt: new Date(),
		updatedAt: new Date(),
		createdBy: "lead",
		dependsOn: [],
	},
};

function setup(clock = { t: 0 }) {
	let pending = false;
	const source: TeamPersistenceSource = {
		hasPendingStateDelta: () => pending,
		drainStateDelta: () => {
			pending = false;
			return {
				teamId: "t",
				teamName: "team",
				reset: false,
				members: [],
				tasks: [],
				mailbox: [],
				missionLog: [],
				runs: [],
				outcomes: [],
				outcomeFragments: [],
			};
		},
		exportState: vi.fn(),
		requeueStateDelta: vi.fn(() => {
			pending = true;
		}),
	};
	const batches: TeamPersistenceBatch[] = [];
	const writer = new TeamPersistenceWriter({
		teamKey: "team",
		store: { persistBatch: (_k, b) => batches.push(b) },
		source: () => source,
		teammates: () => [],
		batchMs: 100,
		telemetryFlushMs: 60_000,
		now: () => clock.t,
	});
	return { writer, batches, markPending: () => (pending = true), source };
}

describe("TeamPersistenceWriter", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("never logs streamed chunks or heartbeats", () => {
		const { writer, batches, markPending } = setup();
		for (let i = 0; i < 1000; i++) {
			markPending();
			writer.onEvent(i % 2 ? chunk : heartbeat);
		}
		vi.advanceTimersByTime(1000);
		// At most one lazy liveness write in the first telemetry window.
		expect(batches.length).toBeLessThanOrEqual(1);
		expect(batches.flatMap((b) => b.events)).toEqual([]);
	});

	it("coalesces bursts of durable events into one write", () => {
		const { writer, batches, markPending } = setup();
		for (let i = 0; i < 50; i++) {
			markPending();
			writer.onEvent(taskUpdated);
		}
		expect(batches).toHaveLength(0);
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.events).toHaveLength(50);
	});

	it("flushes terminal run events immediately", () => {
		const { writer, batches, markPending } = setup();
		markPending();
		writer.onEvent({
			type: TeamMessageType.RunCompleted,
			run: { ...run, status: "completed" },
		});
		expect(batches).toHaveLength(1);
	});

	it("persists liveness at most once per telemetry window", () => {
		const clock = { t: 0 };
		const { writer, batches, markPending } = setup(clock);
		markPending();
		writer.onEvent(taskUpdated);
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(1);

		clock.t = 30_000;
		markPending();
		writer.onEvent(heartbeat);
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(1);

		clock.t = 61_000;
		writer.onEvent(heartbeat);
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(2);
		expect(batches[1]?.events).toEqual([]);
	});

	it("dispose flushes pending work and ignores later events", () => {
		const { writer, batches, markPending } = setup();
		markPending();
		writer.onEvent(taskUpdated);
		writer.dispose();
		expect(batches).toHaveLength(1);
		writer.onEvent(taskUpdated);
		vi.advanceTimersByTime(1000);
		expect(batches).toHaveLength(1);
	});

	it("reports store errors without throwing", () => {
		const onError = vi.fn();
		const writer = new TeamPersistenceWriter({
			teamKey: "team",
			store: {
				persistBatch: () => {
					throw new Error("disk full");
				},
			},
			source: () => setup().source,
			teammates: () => [],
			onError,
		});
		writer.markTeammatesDirty();
		expect(() => writer.flush()).not.toThrow();
		expect(onError).toHaveBeenCalled();
	});

	it("retries a failed batch on the next flush", () => {
		const { source } = setup();
		const batches: TeamPersistenceBatch[] = [];
		let fail = true;
		const writer = new TeamPersistenceWriter({
			teamKey: "team",
			store: {
				persistBatch: (_k, b) => {
					if (fail) throw new Error("database is locked");
					batches.push(b);
				},
			},
			source: () => source,
			teammates: () => [],
			batchMs: 100,
			onError: () => {},
		});
		writer.onEvent(taskUpdated);
		vi.advanceTimersByTime(100);
		expect(source.requeueStateDelta).toHaveBeenCalledTimes(1);
		fail = false;
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.events).toHaveLength(1);
		expect(source.hasPendingStateDelta()).toBe(false);
	});

	it("schedules a write for eventless state changes", () => {
		const { writer, batches, markPending } = setup();
		markPending();
		writer.markStateDirty();
		expect(batches).toHaveLength(0);
		vi.advanceTimersByTime(100);
		expect(batches).toHaveLength(1);
	});

	it("flushes a scheduled retry immediately", () => {
		const { writer, batches, markPending } = setup();
		markPending();
		writer.onEvent({
			type: TeamMessageType.RunProgress,
			run: { ...run, status: "queued", retryCount: 1 },
			message: "retry_scheduled_1",
		});
		expect(batches).toHaveLength(1);
		expect(batches[0]?.events).toHaveLength(1);
	});
});
