import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	TeamRuntimeState,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusService } from "../../../status";
import { SqliteStatusStore } from "../../../status/store/sqlite-status-store";
import type { HubTransportContext } from "./context";
import { attachStatusBroadcast, handleStatusCommand } from "./status-handlers";

let dir: string;
let service: StatusService;
let published: HubEventEnvelope[];
let ctx: HubTransportContext;
let detach: () => void;

function envelope(
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown> = {},
	sessionId?: string,
): HubCommandEnvelope {
	return { version: "v1", command, requestId: "r1", payload, sessionId };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cline-status-hub-"));
	service = new StatusService({
		store: new SqliteStatusStore(join(dir, "status.db")),
	});
	published = [];
	ctx = {
		publish: (event: HubEventEnvelope) => published.push(event),
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
			sessionId?: string,
		): HubEventEnvelope => ({
			version: "v1",
			event,
			payload,
			sessionId,
		}),
	} as unknown as HubTransportContext;
	// The hub bridges publishes onto the wire by subscribing to the service,
	// so tool publishes broadcast too. Wire it the way the transport does.
	detach = attachStatusBroadcast(ctx, service);
});

afterEach(() => {
	detach?.();
	service.close();
	rmSync(dir, { recursive: true, force: true });
});

const basePublish = {
	subject: "migration/auth",
	state: "running",
	headline: "Rewriting the token exchange",
};

describe("handleStatusCommand", () => {
	it("stores the update and broadcasts status.updated", async () => {
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.publish", basePublish),
			service,
		);

		expect(reply.ok).toBe(true);
		expect(published.map((e) => e.event)).toEqual(["status.updated"]);
		expect(service.current("migration/auth")?.headline).toBe(
			basePublish.headline,
		);
	});

	it("does not push normal or low priority to the user", async () => {
		await handleStatusCommand(
			ctx,
			envelope("status.publish", { ...basePublish, priority: "normal" }),
			service,
		);
		await handleStatusCommand(
			ctx,
			envelope("status.publish", {
				...basePublish,
				subject: "b",
				priority: "low",
			}),
			service,
		);
		expect(published.filter((e) => e.event === "ui.notify")).toHaveLength(0);
	});

	it("pushes high and critical priority to the user", async () => {
		await handleStatusCommand(
			ctx,
			envelope("status.publish", {
				...basePublish,
				priority: "high",
				state: "blocked",
			}),
			service,
		);
		await handleStatusCommand(
			ctx,
			envelope("status.publish", {
				...basePublish,
				subject: "b",
				priority: "critical",
				state: "failed",
				agentName: "Adam",
			}),
			service,
		);

		const notifications = published.filter((e) => e.event === "ui.notify");
		expect(notifications).toHaveLength(2);
		expect(notifications[1]?.payload?.title).toBe("Blocked: Adam");
		expect(notifications[1]?.payload?.severity).toBe("error");
	});

	it("defaults sessionId from the envelope when the payload omits it", async () => {
		await handleStatusCommand(
			ctx,
			envelope("status.publish", basePublish, "sess-42"),
			service,
		);
		expect(service.current("migration/auth")?.sessionId).toBe("sess-42");
	});

	it("returns a paginated page for status.query", async () => {
		for (let i = 0; i < 5; i += 1) {
			await handleStatusCommand(
				ctx,
				envelope("status.publish", { ...basePublish, subject: `s/${i}` }),
				service,
			);
		}
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.query", { limit: 2 }),
			service,
		);
		expect(reply.ok).toBe(true);
		const updates = reply.payload?.updates;
		expect(Array.isArray(updates) ? updates.length : 0).toBe(2);
		expect(reply.payload?.hasMore).toBe(true);
		expect(reply.payload?.nextCursor).toEqual(expect.any(Number));
	});

	it("returns only live rows for status.board", async () => {
		await handleStatusCommand(
			ctx,
			envelope("status.publish", { ...basePublish, headline: "old" }),
			service,
		);
		await handleStatusCommand(
			ctx,
			envelope("status.publish", { ...basePublish, headline: "new" }),
			service,
		);
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.board", {}),
			service,
		);
		const updates = reply.payload?.updates as Array<{ headline: string }>;
		expect(updates).toHaveLength(1);
		expect(updates[0]?.headline).toBe("new");
	});

	it("orders the board by attention and includes history counts", async () => {
		// Publish so that recency order would put `done` first and `blocked`
		// last -- the board must invert that.
		await handleStatusCommand(
			ctx,
			envelope("status.publish", {
				subject: "stuck",
				state: "blocked",
				headline: "waiting on creds",
			}),
			service,
		);
		for (const headline of ["one", "two"]) {
			await handleStatusCommand(
				ctx,
				envelope("status.publish", {
					subject: "finished",
					state: "done",
					headline,
				}),
				service,
			);
		}

		const reply = await handleStatusCommand(
			ctx,
			envelope("status.board", {}),
			service,
		);
		const updates = reply.payload?.updates as Array<{
			subject: string;
			historyCount?: number;
		}>;

		expect(updates[0]?.subject).toBe("stuck");
		expect(updates.find((u) => u.subject === "finished")?.historyCount).toBe(2);
	});

	it("summarizes across every live row", async () => {
		for (let i = 0; i < 5; i += 1) {
			await handleStatusCommand(
				ctx,
				envelope("status.publish", {
					subject: `s/${i}`,
					state: i === 0 ? "blocked" : "running",
					headline: "h",
					agentId: "adam",
					agentName: "Adam",
				}),
				service,
			);
		}
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.summary", {}),
			service,
		);
		const summary = reply.payload?.summary as {
			total: number;
			byState: Record<string, number>;
			byAgent: Array<{ agentId: string; blocked: number }>;
		};
		expect(summary.total).toBe(5);
		expect(summary.byState.blocked).toBe(1);
		expect(summary.byState.running).toBe(4);
		expect(summary.byAgent[0]?.blocked).toBe(1);
	});

	it("returns null rather than erroring for an unknown subject", async () => {
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.current", { subject: "nope" }),
			service,
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.update).toBeNull();
	});

	it("reads a requested team snapshot without mutating team state", async () => {
		const team = { teamId: "team-a", tasks: [] } as unknown as TeamRuntimeState;
		let requestedSessionId: string | undefined;
		Object.assign(ctx, {
			sessionHost: {
				readTeamState: async (sessionId: string) => {
					requestedSessionId = sessionId;
					return team;
				},
			} as unknown as HubTransportContext["sessionHost"],
		});

		const reply = await handleStatusCommand(
			ctx,
			envelope("status.tasks_snapshot", { sessionId: "session-a" }),
			service,
		);

		expect(reply.ok).toBe(true);
		expect(requestedSessionId).toBe("session-a");
		expect(reply.payload?.teams).toEqual([team]);
		expect(published).toHaveLength(0);
	});

	it("returns all active team snapshots when no session is requested", async () => {
		const teams = [
			{ teamId: "team-a", tasks: [] },
			{ teamId: "team-b", tasks: [] },
		] as unknown as TeamRuntimeState[];
		let listCalls = 0;
		Object.assign(ctx, {
			sessionHost: {
				listTeamStates: async () => {
					listCalls += 1;
					return teams;
				},
			} as unknown as HubTransportContext["sessionHost"],
		});

		const reply = await handleStatusCommand(
			ctx,
			envelope("status.tasks_snapshot"),
			service,
		);

		expect(reply.ok).toBe(true);
		expect(listCalls).toBe(1);
		expect(reply.payload?.teams).toEqual(teams);
		expect(published).toHaveLength(0);
	});

	it("returns an empty snapshot when the runtime has no active teams", async () => {
		Object.assign(ctx, {
			sessionHost: {
				listTeamStates: async () => [],
			} as unknown as HubTransportContext["sessionHost"],
		});

		const reply = await handleStatusCommand(
			ctx,
			envelope("status.tasks_snapshot"),
			service,
		);

		expect(reply.ok).toBe(true);
		expect(reply.payload?.teams).toEqual([]);
		expect(published).toHaveLength(0);
	});

	it("rejects an invalid payload without broadcasting", async () => {
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.publish", { subject: "x" }),
			service,
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
		expect(published).toHaveLength(0);
	});

	it("rejects a page limit above the server ceiling", async () => {
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.query", { limit: 5000 }),
			service,
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});
});
