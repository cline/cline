import { describe, expect, it } from "vitest";
import { AdaptiveConcurrency } from "./adaptiveConcurrency";
import {
	DriveWaveCheckpointManager,
	InMemoryWaveCheckpointStore,
} from "./checkpoint";
import { failFastReview, scratchPauseReview } from "./reviewGates";
import { DriveWorkMailbox } from "./workMailbox";
import { DriveWorkScratch } from "./workScratch";
import { TokenQueue } from "./tokenQueue";
import { DriveWaveRunner } from "./waveRunner";
import type { DriveWorkExecutor, DriveWorkInput } from "./types";

function syncHost(handler: DriveWorkExecutor["runTask"]): DriveWorkExecutor {
	return { runTask: handler };
}

describe("AdaptiveConcurrency", () => {
	it("increases on success and decreases on failure", () => {
		const concurrency = new AdaptiveConcurrency({
			initial: 2,
			min: 1,
			max: 4,
			increase: 1,
			decrease: 0.5,
		});
		expect(concurrency.onSuccess()).toBe(3);
		expect(concurrency.onSuccess()).toBe(4);
		expect(concurrency.onFailure()).toBe(2);
		expect(concurrency.onRateLimited()).toBe(1);
	});
});

describe("TokenQueue", () => {
	it("admits up to maxPerInterval immediately", async () => {
		const queue = new TokenQueue({
			maxPerInterval: 2,
			intervalMs: 60_000,
		});
		await queue.acquire();
		await queue.acquire();
		queue.close();
	});
});

describe("DriveWorkMailbox", () => {
	it("delivers direct and broadcast messages", () => {
		const box = new DriveWorkMailbox();
		box.send({ from: "a", to: "b", topic: "status", body: { ok: true } });
		box.send({ from: "a", to: "*", topic: "broadcast", body: { n: 1 } });
		expect(box.inbox("b")).toHaveLength(2);
		expect(box.inbox("c", "broadcast")).toHaveLength(1);
	});
});

describe("DriveWorkScratch", () => {
	it("last-write-wins", () => {
		const scratch = new DriveWorkScratch();
		scratch.set("k", 1);
		scratch.writeAll({ k: 2, other: "x" });
		expect(scratch.get("k")).toBe(2);
		expect(scratch.toRecord()).toEqual({ k: 2, other: "x" });
	});
});

describe("DriveWaveCheckpointManager", () => {
	it("round-trips wave state", async () => {
		const store = new InMemoryWaveCheckpointStore();
		const manager = new DriveWaveCheckpointManager(store);
		const saved = await manager.save({
			waveRunId: "wave_1",
			wave: 2,
			tasks: [],
			scratch: { a: 1 },
			workMailbox: [],
		});
		const loaded = await manager.load("wave_1");
		expect(loaded?.id).toBe(saved.id);
		expect(loaded?.scratch).toEqual({ a: 1 });
	});
});

describe("DriveWaveRunner", () => {
	it("runs independent work then dependents", async () => {
		const seen: string[] = [];
		const host = syncHost(async ({ task }) => {
			seen.push(task.id);
			return { ok: true, result: { kind: task.kind } };
		});
		const runner = new DriveWaveRunner({
			host,
			concurrency: { initial: 4, max: 4 },
			tokenQueue: { maxPerInterval: 10, intervalMs: 60_000 },
		});
		const result = await runner.run([
			{ id: "t1", kind: "edit", payload: { file: "a.ts" } },
			{ id: "t2", kind: "edit", payload: { file: "b.ts" } },
			{ id: "t3", kind: "test", dependsOn: ["t1", "t2"] },
		]);
		expect(result.success).toBe(true);
		expect(result.tasks.map((task) => task.status)).toEqual([
			"succeeded",
			"succeeded",
			"succeeded",
		]);
		expect(seen.slice(0, 2).sort()).toEqual(["t1", "t2"]);
		expect(seen[2]).toBe("t3");
	});

	it("spawns dynamic work and records messages", async () => {
		const host = syncHost(async ({ task }) => {
			if (task.kind === "plan") {
				return {
					ok: true,
					spawn: [{ id: "child", kind: "implement" }],
					messages: [{ to: "*", topic: "plan.done", body: { taskId: task.id } }],
					scratchWrites: { lastPlan: task.id },
				};
			}
			return { ok: true };
		});
		const runner = new DriveWaveRunner({ host, waveRunId: "wave_spawn" });
		const result = await runner.run([{ id: "plan", kind: "plan" }]);
		expect(result.success).toBe(true);
		expect(result.tasks.some((task) => task.id === "child")).toBe(true);
		expect(runner.workMailbox.inbox("x", "plan.done")).toHaveLength(1);
		expect(runner.scratch.get("lastPlan")).toBe("plan");
	});

	it("pauses when scratch-pause review fires", async () => {
		const host = syncHost(async () => ({
			ok: true,
			scratchWrites: { "drive.wave.pause": true },
		}));
		const runner = new DriveWaveRunner({
			host,
			gates: [scratchPauseReview()],
			concurrency: { initial: 1, max: 1 },
		});
		const result = await runner.run([
			{ id: "a", kind: "work" },
			{ id: "b", kind: "work" },
		]);
		expect(result.status).toBe("paused");
		expect(result.tasks.filter((task) => task.status === "succeeded")).toHaveLength(
			1,
		);
	});

	it("aborts remaining work with fail-fast review", async () => {
		const host = syncHost(async ({ task }) => {
			if (task.id === "bad") {
				return { ok: false, error: "boom" };
			}
			return { ok: true };
		});
		const runner = new DriveWaveRunner({
			host,
			gates: [failFastReview()],
			concurrency: { initial: 1, max: 1 },
		});
		const result = await runner.run([
			{ id: "bad", kind: "work" },
			{ id: "later", kind: "work" },
		]);
		expect(result.status).toBe("aborted");
		expect(result.tasks.find((task) => task.id === "later")?.status).toBe(
			"pending",
		);
	});

	it("resumes from checkpoint", async () => {
		const store = new InMemoryWaveCheckpointStore();
		const pausingHost = syncHost(async ({ task }) => {
			if (task.id === "a") {
				return { ok: true, scratchWrites: { "drive.wave.pause": true } };
			}
			return { ok: true };
		});
		const pausing = new DriveWaveRunner({
			host: pausingHost,
			waveRunId: "wave_resume",
			checkpointStore: store,
			concurrency: { initial: 1, max: 1 },
			gates: [scratchPauseReview()],
		});
		const paused = await pausing.run([
			{ id: "a", kind: "work" },
			{ id: "b", kind: "work" },
		] satisfies DriveWorkInput[]);
		expect(paused.status).toBe("paused");

		const resumed = new DriveWaveRunner({
			host: syncHost(async () => ({ ok: true })),
			waveRunId: "wave_resume",
			checkpointStore: store,
			gates: [],
		});
		expect(await resumed.resumeFromCheckpoint()).toBe(true);
		resumed.scratch.delete("drive.wave.pause");
		const done = await resumed.run();
		expect(done.success).toBe(true);
		expect(done.tasks.every((task) => task.status === "succeeded")).toBe(true);
	});
});
