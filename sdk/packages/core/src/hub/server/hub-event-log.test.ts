import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { loadSqliteDb } from "@cline/shared/db";
import { describe, expect, it } from "vitest";
import { HubEventLogStore } from "./hub-event-log";

function envelope(
	event: HubEventEnvelope["event"],
	sessionId?: string,
	payload?: Record<string, unknown>,
): HubEventEnvelope {
	return {
		version: "v1",
		event,
		eventId: `hevt_${event}_${sessionId ?? "global"}`,
		sessionId,
		timestamp: Date.now(),
		payload,
	};
}

describe("HubEventLogStore", () => {
	it("opens its database in WAL mode", () => {
		const dbPath = join(
			mkdtempSync(join(tmpdir(), "cline-hub-events-")),
			"hub-events.db",
		);
		const log = new HubEventLogStore({ dbPath });
		log.append(envelope("run.started", "s1"));
		log.close();
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

	it("stamps a monotonically increasing global sequence", () => {
		const log = new HubEventLogStore({ dbPath: ":memory:" });
		const first = log.append(envelope("run.started", "s1"));
		const second = log.append(envelope("assistant.delta", "s1"));
		expect(first.sequence).toBe(1);
		expect(second.sequence).toBe(2);
		expect(log.lastSequence()).toBe(2);
		log.close();
	});

	it("replays events after a cursor, oldest first", () => {
		const log = new HubEventLogStore({ dbPath: ":memory:" });
		log.append(envelope("run.started", "s1"));
		log.append(envelope("assistant.delta", "s1", { text: "a" }));
		log.append(envelope("run.completed", "s1"));
		const replay = log.listAfter(1, {}, 10);
		expect(replay.map((event) => event.event)).toEqual([
			"assistant.delta",
			"run.completed",
		]);
		expect(replay.map((event) => event.sequence)).toEqual([2, 3]);
		expect(replay[0]?.payload).toEqual({ text: "a" });
		log.close();
	});

	it("scopes replay to one session while keeping global order", () => {
		const log = new HubEventLogStore({ dbPath: ":memory:" });
		log.append(envelope("run.started", "s1"));
		log.append(envelope("run.started", "s2"));
		log.append(envelope("run.completed", "s1"));
		const replay = log.listAfter(0, { sessionId: "s1" }, 10);
		expect(replay.map((event) => [event.event, event.sequence])).toEqual([
			["run.started", 1],
			["run.completed", 3],
		]);
		log.close();
	});

	it("bounds replay pages by limit", () => {
		const log = new HubEventLogStore({ dbPath: ":memory:" });
		for (let index = 0; index < 5; index += 1) {
			log.append(envelope("assistant.delta", "s1"));
		}
		expect(log.listAfter(0, {}, 2)).toHaveLength(2);
		expect(log.listAfter(2, {}, 2).map((event) => event.sequence)).toEqual([
			3, 4,
		]);
		log.close();
	});

	it("prunes by retention and row cap", () => {
		const log = new HubEventLogStore({
			dbPath: ":memory:",
			retentionMs: 1_000_000,
			maxRows: 2,
		});
		log.append(envelope("run.started", "s1"));
		log.append(envelope("assistant.delta", "s1"));
		log.append(envelope("run.completed", "s1"));
		log.prune();
		const rows = log.listAfter(0, {}, 10);
		expect(rows.map((event) => event.sequence)).toEqual([2, 3]);
		// Sequences stay monotonic after pruning — cursors never rewind.
		expect(log.append(envelope("run.started", "s2")).sequence).toBe(4);
		log.close();
	});

	it("prunes by size budget and shrinks the file on disk", () => {
		const dbPath = join(
			mkdtempSync(join(tmpdir(), "cline-hub-events-")),
			"hub-events.db",
		);
		const log = new HubEventLogStore({ dbPath, maxTotalBytes: 256 * 1024 });
		// Multibyte text: the budget must count UTF-8 bytes, not characters.
		const bigText = "文".repeat(64 * 1024);
		for (let index = 0; index < 32; index += 1) {
			log.append(envelope("session.updated", "s1", { text: bigText }));
		}
		log.prune();
		const rows = log.listAfter(0, {}, 100);
		// The newest events survive and sequences stay monotonic.
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(32);
		expect(rows.at(-1)?.sequence).toBe(32);
		expect(log.append(envelope("run.started", "s2")).sequence).toBe(33);
		log.close();
		// ~2 MiB was appended; the file reflects the budget, not the high-water mark.
		expect(statSync(dbPath).size).toBeLessThan(512 * 1024);
	});

	it("is inert after close", () => {
		const log = new HubEventLogStore({ dbPath: ":memory:" });
		log.append(envelope("run.started", "s1"));
		log.close();
		expect(log.lastSequence()).toBe(0);
		expect(log.listAfter(0, {}, 10)).toEqual([]);
		expect(() => log.append(envelope("run.completed", "s1"))).not.toThrow();
	});
});
