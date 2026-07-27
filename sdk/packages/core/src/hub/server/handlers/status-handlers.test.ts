import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusService } from "../../../status";
import { SqliteStatusStore } from "../../../status/store/sqlite-status-store";
import type { HubTransportContext } from "./context";
import { handleStatusCommand } from "./status-handlers";

let dir: string;
let service: StatusService;
let published: HubEventEnvelope[];
let ctx: HubTransportContext;

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
});

afterEach(() => {
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
		expect((reply.payload?.updates as unknown[]).length).toBe(2);
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

	it("returns null rather than erroring for an unknown subject", async () => {
		const reply = await handleStatusCommand(
			ctx,
			envelope("status.current", { subject: "nope" }),
			service,
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.update).toBeNull();
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
