import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@cline/shared";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubServerTransport } from "../hub/server/hub-server-transport";
import type { CoreSessionEvent as SessionEvent } from "../types/events";
import { createReportStatusTool } from "./report-status-tool";
import { StatusService } from "./status-service";

const services: StatusService[] = [];
afterEach(() => {
	for (const service of services.splice(0)) service.close();
});
function service() {
	const value = new StatusService(":memory:");
	services.push(value);
	return value;
}

describe("Status Hub lifecycle and attribution", () => {
	it("retains history after reopening and upgrades the old global subject index", () => {
		const dir = mkdtempSync(join(tmpdir(), "status-persist-"));
		const path = join(dir, "status.db");
		const first = new StatusService(path);
		try {
			first.publish({
				subject: "tests",
				sessionId: "one",
				state: "running",
				headline: "Started",
			});
			first.publish({
				subject: "tests",
				sessionId: "one",
				state: "done",
				headline: "Finished",
			});
		} finally {
			first.close();
		}
		const legacy = loadSqliteDb(path);
		legacy.exec(
			"DROP INDEX status_current_session_idx; CREATE UNIQUE INDEX status_current_idx ON status_updates(subject) WHERE superseded_at IS NULL;",
		);
		legacy.close?.();
		const reopened = new StatusService(path);
		try {
			reopened.publish({
				subject: "tests",
				sessionId: "two",
				state: "running",
				headline: "Independent chat",
			});
			expect(reopened.query().updates.map((row) => row.seq)).toEqual([3, 2, 1]);
			expect(reopened.board().updates).toHaveLength(2);
		} finally {
			reopened.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("keeps identical subjects in different sessions independent, including history", () => {
		const status = service();
		status.publish({
			subject: "tests",
			sessionId: "one",
			state: "running",
			headline: "First chat",
		});
		status.publish({
			subject: "tests",
			sessionId: "two",
			state: "blocked",
			headline: "Second chat",
		});
		status.publish({
			subject: "tests",
			sessionId: "one",
			state: "done",
			headline: "First chat finished",
		});
		expect(status.board().updates).toHaveLength(2);
		expect(status.query({ sessionId: "one" }).updates[0]).toMatchObject({
			state: "done",
			previousState: "running",
		});
		expect(status.board().updates.map((row) => row.historyCount)).toEqual([
			1, 2,
		]);
		status.closeSession("two", "aborted");
		expect(status.board().updates.map((row) => row.state)).toEqual([
			"done",
			"cancelled",
		]);
		expect(status.summary().byState).toMatchObject({
			blocked: 0,
			running: 0,
			done: 1,
			cancelled: 1,
		});
	});

	it("closes all unfinished work on restart, keeps finished facts and notifies listeners", () => {
		const status = service();
		for (const state of [
			"queued",
			"running",
			"blocked",
			"done",
			"failed",
		] as const)
			status.publish({
				subject: state,
				sessionId: "one",
				state,
				headline: state,
			});
		const listener = vi.fn();
		status.subscribe(listener);
		status.closeOrphanedReports();
		expect(listener).toHaveBeenCalledTimes(3);
		expect(status.summary().byState).toMatchObject({
			cancelled: 3,
			done: 1,
			failed: 1,
		});
		status.closeOrphanedReports();
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it("rejects model supplied identity and attributes the report to the runtime", async () => {
		const status = service();
		const tool = createReportStatusTool(status, async () => ({
			workspaceRoot: "/trusted/project",
		}));
		const input = { subject: "tests", state: "running", headline: "Testing" };
		const context = {
			sessionId: "trusted-session",
			agentId: "trusted-agent",
			iteration: 1,
		};
		await expect(
			tool.execute({ ...input, agentId: "spoofed" }, context),
		).rejects.toThrow();
		await tool.execute(input, context);
		expect(status.board().updates[0]).toMatchObject({
			sessionId: "trusted-session",
			agentId: "trusted-agent",
			workspaceRoot: "/trusted/project",
		});
		await expect(
			tool.execute(input, { ...context, sessionId: undefined }),
		).rejects.toThrow("hosted session");
	});
});

function transport(dbPath = ":memory:") {
	let emit: (event: SessionEvent) => void = () => {};
	const host = {
		subscribe: (listener: typeof emit) => {
			emit = listener;
			return () => {};
		},
		getSession: vi.fn(async () => ({ workspaceRoot: "/trusted/project" })),
		dispose: vi.fn(),
		listSessions: vi.fn(async () => []),
	};
	const hub = new HubServerTransport({
		statusDbPath: dbPath,
		sessionHost: host as never,
		sessionSearchOptions: { dbPath: ":memory:" },
		scheduleOptions: { dbPath: ":memory:" },
		taskOptions: { dbPath: ":memory:", watchFiles: false },
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
	});
	return {
		hub,
		emit: (event: SessionEvent) => emit(event),
		tool: (hub as unknown as { sessionTools: AgentTool[] }).sessionTools.find(
			(tool) => tool.name === "report_status",
		),
	};
}

describe("native hub status commands", () => {
	it("publishes a durable report, broadcasts it, and closes it on a session event", async () => {
		const { hub, emit, tool } = transport();
		try {
			const seen = vi.fn();
			hub.subscribe("desktop", seen);
			await tool?.execute(
				{ subject: "tests", state: "running", headline: "Testing" },
				{ sessionId: "one", agentId: "agent", iteration: 1 },
			);
			const board = await hub.handleCommand({
				version: "v1",
				command: "status.board",
			});
			expect(board.ok).toBe(true);
			expect(board.payload?.updates).toEqual([
				expect.objectContaining({ state: "running" }),
			]);
			expect(seen.mock.calls[0]?.[0]).toMatchObject({
				event: "status.updated",
				sessionId: "one",
				payload: { update: { subject: "tests" } },
			});
			emit({
				type: "ended",
				payload: { sessionId: "one", reason: "aborted", ts: Date.now() },
			});
			const log = await hub.handleCommand({
				version: "v1",
				command: "status.query",
			});
			expect(log.payload?.updates).toEqual([
				expect.objectContaining({
					state: "cancelled",
					previousState: "running",
				}),
				expect.objectContaining({
					state: "running",
					supersededAt: expect.any(String),
				}),
			]);
			const invalid = await hub.handleCommand({
				version: "v1",
				command: "status.board",
				payload: { limit: 10000 },
			});
			expect(invalid).toMatchObject({
				ok: false,
				error: { code: "status_query_failed" },
			});
		} finally {
			await hub.stop();
		}
	});

	it("isolates an unavailable status database from the rest of the hub", async () => {
		const dir = mkdtempSync(join(tmpdir(), "status-corrupt-"));
		writeFileSync(join(dir, "status.db"), "invalid sqlite");
		const logger = vi.spyOn(console, "error").mockImplementation(() => {});
		const { hub, tool } = transport(join(dir, "status.db"));
		try {
			expect(tool).toBeUndefined();
			expect(
				await hub.handleCommand({ version: "v1", command: "status.board" }),
			).toMatchObject({ ok: false, error: { code: "status_unavailable" } });
			expect(
				await hub.handleCommand({ version: "v1", command: "hub.status" }),
			).toMatchObject({ ok: true });
		} finally {
			await hub.stop();
			logger.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
