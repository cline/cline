import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessageDelivery } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionMailStore } from "../../services/storage/file-session-mail-store";
import type { SessionRow } from "../models/session-row";
import {
	type SessionMailDeliveryTarget,
	SessionMessageRejectedError,
	SessionMessenger,
} from "./session-messenger";

function makeRow(sessionId: string, status = "idle"): SessionRow {
	return {
		sessionId,
		source: "test",
		pid: 1,
		startedAt: "2026-07-27T00:00:00.000Z",
		status: status as SessionRow["status"],
		statusLock: 0,
		interactive: true,
		provider: "anthropic",
		model: "claude-opus-5",
		cwd: `/repo/${sessionId}`,
		workspaceRoot: "/repo",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: `work on ${sessionId}`,
		updatedAt: "2026-07-27T00:00:00.000Z",
	};
}

interface Harness {
	messenger: SessionMessenger;
	delivered: Array<{ sessionId: string; delivery: SessionMessageDelivery }>;
	store: FileSessionMailStore;
	setLive(sessionId: string, live: boolean): void;
}

describe("SessionMessenger", () => {
	let tempDir: string;
	let harness: Harness;

	function build(options?: { rows?: SessionRow[] }): Harness {
		const rows = options?.rows ?? [makeRow("alpha"), makeRow("beta")];
		const live = new Set(rows.map((row) => row.sessionId));
		const delivered: Array<{
			sessionId: string;
			delivery: SessionMessageDelivery;
		}> = [];
		const store = new FileSessionMailStore({ mailDir: tempDir });
		store.init();
		const target: SessionMailDeliveryTarget = {
			deliver: async ({ sessionId, delivery }) => {
				if (!live.has(sessionId)) {
					return false;
				}
				delivered.push({ sessionId, delivery });
				return true;
			},
		};
		const messenger = new SessionMessenger({
			store,
			directory: {
				getSession: async (sessionId) =>
					rows.find((row) => row.sessionId === sessionId),
				listSessions: async ({ limit }) => rows.slice(0, limit),
			},
			target,
		});
		return {
			messenger,
			delivered,
			store,
			setLive: (sessionId, isLive) => {
				if (isLive) {
					live.add(sessionId);
				} else {
					live.delete(sessionId);
				}
			},
		};
	}

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cline-mail-"));
		harness = build();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("delivers to a live peer and records it as delivered", async () => {
		const result = await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "handoff",
			body: "please pick up the migration",
		});

		expect(result.deliveredNow).toBe(true);
		expect(result.message.hopCount).toBe(1);
		expect(harness.delivered).toEqual([
			{ sessionId: "beta", delivery: "queue" },
		]);
		expect(harness.store.get(result.message.id)?.status).toBe("delivered");
	});

	it("keeps a message pending when the target is not live, then drains it", async () => {
		harness.setLive("beta", false);

		const result = await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "later",
			body: "read this when you wake up",
		});
		expect(result.deliveredNow).toBe(false);
		expect(harness.store.get(result.message.id)?.status).toBe("pending");
		expect(harness.delivered).toHaveLength(0);

		harness.setLive("beta", true);
		const drained = await harness.messenger.deliverPending("beta");

		expect(drained).toBe(1);
		expect(harness.delivered).toHaveLength(1);
		expect(harness.store.get(result.message.id)?.status).toBe("delivered");
	});

	it("passes steer delivery through to the target", async () => {
		await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "stop",
			body: "drop what you are doing",
			delivery: "steer",
		});

		expect(harness.delivered[0]?.delivery).toBe("steer");
	});

	it("refuses a send to itself", async () => {
		await expect(
			harness.messenger.send({
				fromSessionId: "alpha",
				toSessionId: "alpha",
				subject: "hi",
				body: "me",
			}),
		).rejects.toMatchObject({ reason: "self_send" });
	});

	it("refuses an unknown recipient", async () => {
		await expect(
			harness.messenger.send({
				fromSessionId: "alpha",
				toSessionId: "ghost",
				subject: "hi",
				body: "anyone there",
			}),
		).rejects.toMatchObject({ reason: "unknown_peer" });
	});

	it("increments hop count along a delivered chain", async () => {
		const rows = [makeRow("alpha"), makeRow("beta"), makeRow("gamma")];
		harness = build({ rows });

		// alpha -> beta is hop 1; beta was woken, so beta -> gamma is hop 2.
		await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "one",
			body: "one",
		});
		const second = await harness.messenger.send({
			fromSessionId: "beta",
			toSessionId: "gamma",
			subject: "two",
			body: "two",
		});

		expect(second.message.hopCount).toBe(2);
		expect(second.message.hopChain).toEqual(["alpha", "beta"]);
	});

	it("stops a chain once it exceeds the hop limit", async () => {
		const rows = [
			makeRow("alpha"),
			makeRow("beta"),
			makeRow("gamma"),
			makeRow("delta"),
		];
		harness = build({ rows });

		await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "1",
			body: "1",
		});
		await harness.messenger.send({
			fromSessionId: "beta",
			toSessionId: "gamma",
			subject: "2",
			body: "2",
		});
		await harness.messenger.send({
			fromSessionId: "gamma",
			toSessionId: "delta",
			subject: "3",
			body: "3",
		});

		// Fourth hop exceeds the default limit of 3.
		await expect(
			harness.messenger.send({
				fromSessionId: "delta",
				toSessionId: "alpha",
				subject: "4",
				body: "4",
			}),
		).rejects.toBeInstanceOf(SessionMessageRejectedError);
	});

	it("refuses a send that would loop back into the chain", async () => {
		await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "ping",
			body: "ping",
		});

		// beta replying to alpha would put alpha in its own chain twice.
		await expect(
			harness.messenger.send({
				fromSessionId: "beta",
				toSessionId: "alpha",
				subject: "pong",
				body: "pong",
			}),
		).rejects.toMatchObject({ reason: "cycle" });
	});

	it("enforces the per-window send rate limit", async () => {
		const rows = [makeRow("alpha"), makeRow("beta")];
		const store = new FileSessionMailStore({ mailDir: tempDir });
		store.init();
		const messenger = new SessionMessenger({
			store,
			directory: {
				getSession: async (sessionId) =>
					rows.find((row) => row.sessionId === sessionId),
				listSessions: async () => rows,
			},
			target: { deliver: async () => true },
			limits: { maxSendsPerWindow: 2, maxHops: 99 },
		});

		await messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "1",
			body: "1",
		});
		await messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "2",
			body: "2",
		});

		await expect(
			messenger.send({
				fromSessionId: "alpha",
				toSessionId: "beta",
				subject: "3",
				body: "3",
			}),
		).rejects.toMatchObject({ reason: "rate_limit" });
	});

	it("reads the inbox and marks messages read", async () => {
		await harness.messenger.send({
			fromSessionId: "alpha",
			toSessionId: "beta",
			subject: "note",
			body: "the body",
		});

		const first = harness.messenger.readInbox({ sessionId: "beta" });
		expect(first).toHaveLength(1);
		expect(first[0]?.subject).toBe("note");

		const second = harness.messenger.readInbox({ sessionId: "beta" });
		expect(second).toHaveLength(0);
	});

	it("excludes the caller from the peer list", async () => {
		const peers = await harness.messenger.listPeers({
			excludeSessionId: "alpha",
		});
		expect(peers.map((peer) => peer.sessionId)).toEqual(["beta"]);
		expect(peers[0]?.reachable).toBe(true);
	});

	it("marks terminal sessions as unreachable peers", async () => {
		harness = build({
			rows: [makeRow("alpha"), makeRow("beta", "completed")],
		});
		const peers = await harness.messenger.listPeers({
			excludeSessionId: "alpha",
		});
		expect(peers[0]?.reachable).toBe(false);
	});
});
