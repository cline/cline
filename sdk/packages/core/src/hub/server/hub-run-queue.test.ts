import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { describe, expect, it } from "vitest";
import { HubRunAdmissionRejectedError, HubRunQueue } from "./hub-run-queue";

describe("HubRunQueue", () => {
	it("opens its database in WAL mode", () => {
		const dbPath = join(
			mkdtempSync(join(tmpdir(), "cline-hub-runs-")),
			"hub-runs.db",
		);
		const queue = new HubRunQueue({ dbPath });
		queue.admit("s1", { prompt: "one" });
		queue.close();
		// WAL is persistent: a fresh connection observes the configured mode.
		const db = loadSqliteDb(dbPath);
		try {
			expect(
				String(db.prepare("PRAGMA journal_mode;").get()?.journal_mode),
			).toBe("wal");
		} finally {
			db.close?.();
		}
	});

	it("acks admission immediately with runId, acceptedAt, and queue position", () => {
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const first = queue.admit("s1", { prompt: "one" }, "client-a");
		const second = queue.admit("s1", { prompt: "two" });
		expect(first.runId).toMatch(/^hrun_/);
		expect(first.queuePosition).toBe(0);
		expect(second.queuePosition).toBe(1);
		expect(first.acceptedAt).toBeGreaterThan(0);
		queue.close();
	});

	it("dequeues in FIFO admission order per session", () => {
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const first = queue.admit("s1", { prompt: "one" });
		queue.admit("s2", { prompt: "other-session" });
		const second = queue.admit("s1", { prompt: "two" });
		expect(queue.nextQueued("s1")?.runId).toBe(first.runId);
		queue.markRunning(first.runId);
		expect(queue.nextQueued("s1")?.runId).toBe(second.runId);
		expect(queue.hasRunning("s1")).toBe(true);
		queue.markTerminal(first.runId, "completed");
		expect(queue.hasRunning("s1")).toBe(false);
		queue.close();
	});

	it("applies backpressure with a retryable admission rejection", () => {
		const queue = new HubRunQueue({
			dbPath: ":memory:",
			maxPendingPerSession: 2,
		});
		queue.admit("s1", { prompt: "one" });
		queue.admit("s1", { prompt: "two" });
		try {
			queue.admit("s1", { prompt: "three" });
			expect.unreachable("third admission must reject");
		} catch (error) {
			expect(error).toBeInstanceOf(HubRunAdmissionRejectedError);
			expect((error as HubRunAdmissionRejectedError).retryable).toBe(true);
		}
		// A different session is unaffected by s1's full queue.
		expect(queue.admit("s2", { prompt: "ok" }).queuePosition).toBe(0);
		queue.close();
	});

	it("recovers on startup: running becomes interrupted, queued re-admits FIFO", () => {
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const crashed = queue.admit("s1", { prompt: "crashed mid-turn" });
		queue.markRunning(crashed.runId);
		const queuedA = queue.admit("s1", { prompt: "queued a" });
		const queuedB = queue.admit("s2", { prompt: "queued b" });

		const recovered = queue.recoverOnStartup();
		expect(recovered.interrupted.map((run) => run.runId)).toEqual([
			crashed.runId,
		]);
		expect(recovered.requeued.map((run) => run.runId)).toEqual([
			queuedA.runId,
			queuedB.runId,
		]);
		expect(queue.get(crashed.runId)?.state).toBe("interrupted");
		expect(queue.get(crashed.runId)?.error).toContain("exited");
		expect(queue.nextQueued("s1")?.runId).toBe(queuedA.runId);
		queue.close();
	});

	it("records terminal states with errors and lists newest first", () => {
		const queue = new HubRunQueue({ dbPath: ":memory:" });
		const first = queue.admit("s1", { prompt: "one" });
		const second = queue.admit("s1", { prompt: "two" });
		queue.markRunning(first.runId);
		queue.markTerminal(first.runId, "failed", "provider exploded");
		const listed = queue.list({ sessionId: "s1" });
		expect(listed.map((run) => run.runId)).toEqual([second.runId, first.runId]);
		expect(listed[1]?.state).toBe("failed");
		expect(listed[1]?.error).toBe("provider exploded");
		queue.close();
	});
});
