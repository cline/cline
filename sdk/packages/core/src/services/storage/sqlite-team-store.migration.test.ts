import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamRuntimeState } from "@cline/shared";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteTeamStore } from "./sqlite-team-store";
import {
	fixedNow,
	fullAgentResult,
	run,
	TEAM,
	task,
	V1_SCHEMA_SQL,
} from "./sqlite-team-store.fixtures";

describe("SqliteTeamStore v1 -> v2 migration", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-team-store-mig-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function seedV1Database(state: TeamRuntimeState): void {
		const db = loadSqliteDb(join(dir, "teams.db"));
		db.exec(V1_SCHEMA_SQL);
		db.prepare("INSERT INTO team_runtime_snapshot VALUES (?, ?, ?, ?)").run(
			TEAM,
			JSON.stringify(state),
			JSON.stringify([{ agentId: "worker", rolePrompt: "p" }]),
			fixedNow.toISOString(),
		);
		const insertEvent = db.prepare(
			"INSERT INTO team_events (team_name, ts, event_type, payload_json) VALUES (?, ?, ?, ?)",
		);
		const ts = new Date().toISOString();
		insertEvent.run(TEAM, ts, "agent_event", "{}");
		insertEvent.run(TEAM, ts, "run_progress", '{"message":"heartbeat"}');
		insertEvent.run(
			TEAM,
			ts,
			"task_end",
			JSON.stringify({
				type: "task_end",
				agentId: "worker",
				result: fullAgentResult,
				messages: fullAgentResult.messages,
			}),
		);
		insertEvent.run(TEAM, ts, "team_message", '{"ok":true}');
		db.close?.();
	}

	const legacyState = (): TeamRuntimeState => ({
		teamId: "t_legacy",
		teamName: TEAM,
		members: [
			{ agentId: "lead", role: "lead", status: "idle" },
			{ agentId: "worker", role: "teammate", status: "stopped" },
		],
		tasks: [task("task_0001", "completed")],
		mailbox: [
			{
				id: "msg_00001",
				teamId: "t_legacy",
				fromAgentId: "lead",
				toAgentId: "worker",
				subject: "s",
				body: "b",
				sentAt: fixedNow,
			},
		],
		missionLog: [
			{
				id: "log_000001",
				ts: fixedNow,
				teamId: "t_legacy",
				agentId: "lead",
				kind: "progress",
				summary: "s",
			},
		],
		runs: [run("run_00001", { status: "completed", result: fullAgentResult })],
		outcomes: [],
		outcomeFragments: [],
	});

	it("moves snapshots into rows, compacts results, drops telemetry", () => {
		seedV1Database(legacyState());

		const store = new SqliteTeamStore({ teamDir: dir });
		store.init();
		const loaded = store.loadRuntime(TEAM);
		store.close();

		expect(loaded.state?.teamId).toBe("t_legacy");
		expect(loaded.state?.members).toHaveLength(2);
		expect(loaded.state?.tasks.map((t) => t.id)).toEqual(["task_0001"]);
		expect(loaded.state?.mailbox.map((m) => m.id)).toEqual(["msg_00001"]);
		expect(loaded.state?.missionLog.map((e) => e.id)).toEqual(["log_000001"]);
		expect(loaded.state?.runs[0]?.status).toBe("completed");
		expect((loaded.state?.runs[0]?.result as { text: string }).text).toBe(
			"done",
		);
		expect(JSON.stringify(loaded.state)).not.toContain("TRANSCRIPT");
		expect(loaded.teammates).toEqual([{ agentId: "worker", rolePrompt: "p" }]);

		const db = loadSqliteDb(join(dir, "teams.db"));
		const types = db
			.prepare("SELECT event_type FROM team_events ORDER BY id")
			.all()
			.map((r) => r.event_type);
		const snapshot = db
			.prepare("SELECT state_json FROM team_runtime_snapshot")
			.get();
		const taskEnd = db
			.prepare(
				"SELECT payload_json FROM team_events WHERE event_type = 'task_end'",
			)
			.get();
		const version = db
			.prepare("SELECT version FROM team_store_schema_version")
			.get();
		db.close?.();

		expect(types).toEqual(["task_end", "team_message"]);
		expect(snapshot?.state_json).toBe("");
		expect(String(taskEnd?.payload_json)).not.toContain("TRANSCRIPT");
		expect(version?.version).toBe(2);
	});

	it("re-imports state_json written by an older build after rollback", () => {
		seedV1Database(legacyState());
		const upgraded = new SqliteTeamStore({ teamDir: dir });
		upgraded.init();
		upgraded.close();

		// Simulate a rolled-back (v1) build writing its blob over the v2 store.
		const rolledBack: TeamRuntimeState = {
			...legacyState(),
			tasks: [task("task_0001", "completed"), task("task_0002", "pending")],
		};
		const db = loadSqliteDb(join(dir, "teams.db"));
		db.prepare(
			"UPDATE team_runtime_snapshot SET state_json = ? WHERE team_name = ?",
		).run(JSON.stringify(rolledBack), TEAM);
		db.close?.();

		const reopened = new SqliteTeamStore({ teamDir: dir });
		reopened.init();
		const loaded = reopened.loadRuntime(TEAM);
		reopened.close();

		expect(loaded.state?.tasks.map((t) => t.id)).toEqual([
			"task_0001",
			"task_0002",
		]);
		const check = loadSqliteDb(join(dir, "teams.db"));
		const snapshot = check
			.prepare("SELECT state_json FROM team_runtime_snapshot")
			.get();
		check.close?.();
		expect(snapshot?.state_json).toBe("");
	});

	it("is idempotent across reopen and supports vacuum", () => {
		seedV1Database(legacyState());
		const first = new SqliteTeamStore({ teamDir: dir });
		first.init();
		first.close();

		const second = new SqliteTeamStore({ teamDir: dir });
		expect(second.readState(TEAM)?.tasks.map((t) => t.id)).toEqual([
			"task_0001",
		]);
		second.vacuum();
		second.close();
	});
});
