import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteTeamStore } from "./sqlite-team-store";
import {
	batch,
	emptyDelta,
	fullAgentResult,
	run,
	TEAM,
	task,
} from "./sqlite-team-store.fixtures";

describe("SqliteTeamStore v2", () => {
	let dir: string;
	let store: SqliteTeamStore;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-team-store-"));
		store = new SqliteTeamStore({ teamDir: dir, eventRetentionPerTeam: 5 });
		store.init();
	});

	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("applies incremental deltas and rebuilds state from rows", () => {
		const teammates = [{ agentId: "worker", rolePrompt: "p" }];
		store.persistBatch(
			TEAM,
			batch(
				emptyDelta({
					tasks: [task("task_0001")],
					runs: [run("run_1", { lastProgressAt: new Date() })],
				}),
				[{ type: "team_task_updated", payload: { a: 1 } }],
				teammates,
			),
		);
		store.persistBatch(
			TEAM,
			batch(emptyDelta({ tasks: [task("task_0002")] }), [], teammates),
		);

		const loaded = store.loadRuntime(TEAM);
		expect(loaded.state?.tasks.map((t) => t.id)).toEqual([
			"task_0001",
			"task_0002",
		]);
		expect(loaded.state?.tasks[0]?.createdAt).toBeInstanceOf(Date);
		expect(loaded.state?.runs.map((r) => r.id)).toEqual(["run_1"]);
		expect(loaded.state?.runs[0]?.lastProgressAt).toBeInstanceOf(Date);
		expect(loaded.teammates).toEqual(teammates);
		expect(store.listTeamNames()).toEqual([TEAM]);
	});

	it("never writes a state_json blob", () => {
		store.persistBatch(TEAM, batch(emptyDelta({ tasks: [task("task_0001")] })));
		const db = loadSqliteDb(join(dir, "teams.db"));
		const row = db
			.prepare(
				"SELECT state_json FROM team_runtime_snapshot WHERE team_name = ?",
			)
			.get(TEAM);
		db.close?.();
		expect(row?.state_json).toBe("");
	});

	it("does not bump untouched rows", () => {
		store.persistBatch(TEAM, batch(emptyDelta({ runs: [run("run_1")] })));
		for (let i = 0; i < 20; i++) {
			store.persistBatch(TEAM, batch(emptyDelta({ tasks: [task("task_x")] })));
		}
		const db = loadSqliteDb(join(dir, "teams.db"));
		const row = db
			.prepare("SELECT version FROM team_runs WHERE run_id = 'run_1'")
			.get();
		db.close?.();
		expect(row?.version).toBe(1);
	});

	it("compacts full run results defensively", () => {
		store.persistBatch(
			TEAM,
			batch(
				emptyDelta({
					runs: [
						run("run_1", { status: "completed", result: fullAgentResult }),
					],
				}),
			),
		);
		const state = store.readState(TEAM);
		expect(JSON.stringify(state?.runs)).not.toContain("TRANSCRIPT");
		expect((state?.runs[0]?.result as { text: string }).text).toBe("done");
	});

	it("reset deltas drop removed entities", () => {
		store.persistBatch(TEAM, batch(emptyDelta({ tasks: [task("task_0001")] })));
		store.persistBatch(TEAM, batch(emptyDelta({ reset: true })));
		expect(store.readState(TEAM)?.tasks).toEqual([]);
	});

	it("caps the event log per team", () => {
		for (let i = 0; i < 12; i++) {
			store.persistBatch(
				TEAM,
				batch(emptyDelta(), [{ type: "team_message", payload: { i } }]),
			);
		}
		const history = store.readHistory(TEAM, 100) as Array<{
			payload: { i: number };
		}>;
		expect(history).toHaveLength(5);
		expect(history[0]?.payload.i).toBe(11);
	});

	it("drops telemetry on the legacy handleTeamEvent path", () => {
		store.handleTeamEvent(TEAM, {
			type: "run_progress",
			run: run("run_1"),
			message: "heartbeat",
		} as never);
		expect(store.readHistory(TEAM)).toEqual([]);
	});

	it("caps the event log on the legacy handleTeamEvent path", () => {
		for (let i = 0; i < 12; i++) {
			store.handleTeamEvent(TEAM, {
				type: "run_completed",
				run: run(`run_${i}`),
			} as never);
		}
		expect(store.readHistory(TEAM, 100)).toHaveLength(5);
	});

	it("marks in-progress runs interrupted in rows", () => {
		store.persistBatch(TEAM, batch(emptyDelta({ runs: [run("run_1")] })));
		expect(store.markInProgressRunsInterrupted(TEAM, "crash")).toEqual([
			"run_1",
		]);
		const [r] = store.readState(TEAM)?.runs ?? [];
		expect(r?.status).toBe("interrupted");
		expect(r?.error).toBe("crash");
	});
});
