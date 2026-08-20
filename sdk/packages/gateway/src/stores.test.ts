/**
 * SQLite authority stores: migrations, repository invariants, the
 * durable idempotency ledger, the global event log, canonical message
 * history, outbox bookkeeping, audit, and the client registry.
 */

import { join } from "node:path";
import { RoleImmutableError, WorkspaceImmutableError } from "@cline/bot";
import type { AgentMessage } from "@cline/shared";
import { loadSqliteDb } from "@cline/shared/db";
import {
	createBotId,
	createClientId,
	createIdempotencyKey,
	createRunId,
	createSessionId,
	GATEWAY_PROTOCOL_VERSION,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	GATEWAY_MIGRATIONS,
	migrateGatewayDatabase,
	openGatewayDatabase,
} from "./db";
import { createGatewayStores } from "./stores";
import { tempDataRoot } from "./test-support";

function openStores() {
	const database = openGatewayDatabase(join(tempDataRoot(), "gateway.db"));
	return { database, stores: createGatewayStores(database, "gwi_test") };
}

function botRecord(botId = createBotId()) {
	return {
		identity: {
			botId,
			name: "cline",
			role: "lead" as const,
			parentBotId: null,
			provenance: { createdBy: "bootstrap" as const },
			createdAt: 1,
		},
		config: {},
		status: "active" as const,
		revision: 0,
	};
}

describe("migrations", () => {
	it("apply once and are idempotent across re-open", () => {
		const file = join(tempDataRoot(), "gateway.db");
		const first = openGatewayDatabase(file);
		first.close();
		const second = openGatewayDatabase(file);
		const applied = second.db
			.prepare("SELECT version FROM migrations ORDER BY version;")
			.all()
			.map((row) => Number(row.version));
		expect(applied).toEqual(GATEWAY_MIGRATIONS.map((m) => m.version));
		second.close();
	});

	it("adds run config snapshots to databases already on migration 1", () => {
		const file = join(tempDataRoot(), "gateway-v1.db");
		const db = loadSqliteDb(file);
		for (const statement of GATEWAY_MIGRATIONS[0].statements) db.exec(statement);
		db.exec(`CREATE TABLE migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		);`);
		db.prepare(
			"INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?);",
		).run(1, "phase-3-authority", 1);

		migrateGatewayDatabase(db);

		const columns = db
			.prepare("PRAGMA table_info(runs);")
			.all()
			.map((row) => String(row.name));
		expect(columns).toContain("config_json");
		db.close?.();
	});
});

describe("meta", () => {
	it("gatewayId is created once and stable across re-open", () => {
		const file = join(tempDataRoot(), "gateway.db");
		const first = openGatewayDatabase(file);
		const stores = createGatewayStores(first, "gwi_a");
		const created = stores.meta.ensureGatewayId();
		first.close();
		const second = openGatewayDatabase(file);
		const reopened = createGatewayStores(second, "gwi_b");
		expect(reopened.meta.ensureGatewayId()).toBe(created);
		second.close();
	});
});

describe("repositories", () => {
	it("bot repository rejects role/parent mutation", () => {
		const { stores } = openStores();
		const record = botRecord();
		stores.bots.save(record);
		expect(() =>
			stores.bots.save({
				...record,
				identity: { ...record.identity, role: "worker", parentBotId: null },
			}),
		).toThrow(RoleImmutableError);
	});

	it("session repository rejects workspace mutation", () => {
		const { stores } = openStores();
		const sessionId = createSessionId();
		const botId = createBotId();
		stores.sessions.save({
			sessionId,
			botId,
			workspace: { rootPath: "/a" },
			state: "active",
			createdAt: 1,
			revision: 0,
		});
		expect(() =>
			stores.sessions.save({
				sessionId,
				botId,
				workspace: { rootPath: "/b" },
				state: "active",
				createdAt: 1,
				revision: 1,
			}),
		).toThrow(WorkspaceImmutableError);
	});

	it("runs keep durable FIFO admission order", () => {
		const { stores } = openStores();
		const sessionId = createSessionId();
		const botId = createBotId();
		const runIds = [createRunId(), createRunId(), createRunId()];
		for (const runId of runIds) {
			stores.runs.save({
				runId,
				sessionId,
				botId,
				state: "queued",
				input: "x",
				acceptedAt: 1,
			});
		}
		expect(stores.runs.listQueued().map((run) => run.runId)).toEqual(runIds);
		expect(stores.runs.countPendingBySession(sessionId)).toBe(3);
	});

	it("run attempts number sequentially and interrupt open attempts on recovery", () => {
		const { stores } = openStores();
		const runId = createRunId();
		const first = stores.attempts.begin(runId, 10);
		expect(first.attempt).toBe(1);
		stores.attempts.settle(runId, 1, "failed", 20, {
			name: "E",
			message: "boom",
		});
		const second = stores.attempts.begin(runId, 30);
		expect(second.attempt).toBe(2);
		const open = stores.attempts.interruptOpenAttempts(40);
		expect(open.map((attempt) => attempt.attempt)).toEqual([2]);
		const attempts = stores.attempts.listByRun(runId);
		expect(attempts.map((attempt) => attempt.state)).toEqual([
			"failed",
			"interrupted",
		]);
	});
});

describe("durable idempotency ledger", () => {
	it("new -> pending -> replay, with conflicts on divergent reuse", () => {
		const { stores } = openStores();
		const key = createIdempotencyKey();
		const params = { idempotencyKey: key, prompt: "hi" };
		expect(stores.idempotency.begin(key, "run.start", params).kind).toBe("new");
		expect(stores.idempotency.begin(key, "run.start", params).kind).toBe(
			"pending",
		);
		const response = {
			version: GATEWAY_PROTOCOL_VERSION,
			id: "req_1",
			result: { ok: true },
		};
		stores.idempotency.record(key, response);
		const replay = stores.idempotency.begin(key, "run.start", params);
		expect(replay.kind).toBe("replay");
		if (replay.kind === "replay") {
			expect(replay.response).toEqual(response);
		}
		const conflict = stores.idempotency.begin(key, "run.abort", params);
		expect(conflict.kind).toBe("conflict");
	});

	it("forget releases a key for retryable failures", () => {
		const { stores } = openStores();
		const key = createIdempotencyKey();
		expect(stores.idempotency.begin(key, "run.start", {}).kind).toBe("new");
		stores.idempotency.forget(key);
		expect(stores.idempotency.begin(key, "run.start", {}).kind).toBe("new");
	});

	it("survives re-open (durable, unlike the Phase 0 in-memory ledger)", () => {
		const file = join(tempDataRoot(), "gateway.db");
		const first = openGatewayDatabase(file);
		const stores = createGatewayStores(first, "gwi_a");
		const key = createIdempotencyKey();
		stores.idempotency.begin(key, "run.start", { p: 1 });
		stores.idempotency.record(key, {
			version: GATEWAY_PROTOCOL_VERSION,
			id: "req_9",
			result: { runId: "run_x" },
		});
		first.close();
		const second = openGatewayDatabase(file);
		const reopened = createGatewayStores(second, "gwi_b");
		const outcome = reopened.idempotency.begin(key, "run.start", { p: 1 });
		expect(outcome.kind).toBe("replay");
		second.close();
	});
});

describe("event log", () => {
	it("assigns a monotonic global sequence and filters replay by scope", () => {
		const { stores } = openStores();
		const sessionA = createSessionId();
		const sessionB = createSessionId();
		const runA = createRunId();
		const first = stores.events.append(
			"run.queued",
			{ sessionId: sessionA, runId: runA },
			{ n: 1 },
			1,
		);
		const second = stores.events.append(
			"run.queued",
			{ sessionId: sessionB },
			{ n: 2 },
			2,
		);
		expect(second.sequence).toBeGreaterThan(first.sequence);

		const all = stores.events.listAfter(-1, {}, 10);
		expect(all).toHaveLength(2);
		const onlyA = stores.events.listAfter(-1, { sessionId: sessionA }, 10);
		expect(onlyA.map((event) => event.payload?.n)).toEqual([1]);
		const afterFirst = stores.events.listAfter(first.sequence, {}, 10);
		expect(afterFirst.map((event) => event.sequence)).toEqual([
			second.sequence,
		]);
	});

	it("notifies live listeners after the write", async () => {
		const { stores } = openStores();
		const seen: number[] = [];
		stores.events.subscribe((event) => seen.push(event.sequence));
		const appended = stores.events.append("run.queued", {}, undefined, 1);
		expect(seen).toEqual([]); // deferred to a microtask
		await Promise.resolve();
		expect(seen).toEqual([appended.sequence]);
	});
});

describe("canonical message history", () => {
	it("stores AgentMessage payloads in global order per session", () => {
		const { stores } = openStores();
		const sessionId = createSessionId();
		const runId = createRunId();
		const message = (id: string, text: string): AgentMessage => ({
			id,
			role: "assistant",
			content: [{ type: "text", text }],
			createdAt: Date.now(),
		});
		stores.messages.append(sessionId, runId, message("m1", "hello"));
		stores.messages.append(sessionId, runId, message("m2", "world"));
		const stored = stores.messages.listBySession(sessionId);
		expect(stored.map((entry) => entry.message.id)).toEqual(["m1", "m2"]);
		expect(stored[0].runId).toBe(runId);
		expect(stores.messages.countBySession(sessionId)).toBe(2);
	});
});

describe("outbox and audit and clients", () => {
	it("outbox entries stay pending until marked done and count attempts", () => {
		const { stores } = openStores();
		stores.outbox.enqueue("session.projection", { sessionId: "ses_x" }, 1);
		const [entry] = stores.outbox.listPending(10);
		expect(entry.state).toBe("pending");
		stores.outbox.markFailed(entry.outboxId, "disk full");
		expect(stores.outbox.listPending(10)[0].attempts).toBe(1);
		stores.outbox.markDone(entry.outboxId, 2);
		expect(stores.outbox.countPending()).toBe(0);
	});

	it("audit records actor, action, and details", () => {
		const { stores } = openStores();
		stores.audit.record("cli_x", "run.start", "run_1", { botId: "bot_1" }, 5);
		const [entry] = stores.audit.list();
		expect(entry.actor).toBe("cli_x");
		expect(entry.action).toBe("run.start");
		expect(entry.details).toEqual({ botId: "bot_1" });
	});

	it("client registry upserts on hello and counts connections", () => {
		const { stores } = openStores();
		const clientId = createClientId();
		stores.clients.registerHello(clientId, "cli", "1.0.0", 10);
		const updated = stores.clients.registerHello(clientId, "cli", "1.0.1", 20);
		expect(updated.connections).toBe(2);
		expect(updated.version).toBe("1.0.1");
		expect(updated.firstSeenAt).toBe(10);
		expect(stores.clients.count()).toBe(1);
	});
});
