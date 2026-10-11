// Bun-only regression coverage for claimDueRuns (issue #14389).
//
// vitest runs on Node, where node:sqlite (DatabaseSync) accepts named
// parameters bound with both prefixed and unprefixed keys, so the desktop
// bug — bun:sqlite binding unprefixed keys as NULL — cannot be caught by
// the vitest suite. This file runs under `bun test` (Bun's own runner with
// bun:sqlite), which is the exact runtime the Cline Desktop app uses.
/// <reference types="bun" />
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { SqliteCronStore } from "./sqlite-cron-store";

// Direct proof of the binding semantics that broke claimDueRuns: under
// bun:sqlite an unprefixed key binds as NULL, the prefixed key binds the
// value. If claimDueRuns ever regresses to unprefixed keys again, the
// end-to-end test below fails.
test("bun:sqlite binds named parameters by exact token (prefixed key required)", () => {
	const db = new Database(":memory:");
	const query = db.query("SELECT :now AS v");
	expect(query.get({ now: "x" })).toEqual({ v: null });
	expect(query.get({ ":now": "x" })).toEqual({ v: "x" });
	db.close();
});

let dir: string;
let store: SqliteCronStore;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "cline-cron-bun-"));
	store = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
});

afterAll(() => {
	store.close();
	rmSync(dir, { recursive: true, force: true });
});

test("claimDueRuns claims a due run under bun:sqlite", () => {
	const spec = store
		.upsertSpec({
			externalId: "cleanup",
			sourcePath: "cleanup.md",
			triggerKind: "one_off",
			sourceHash: "h",
			parseStatus: "valid",
			spec: {
				triggerKind: "one_off",
				id: "cleanup",
				title: "Clean",
				prompt: "p",
				workspaceRoot: "/ws",
				enabled: true,
			},
		})
		.record;
	store.enqueueRun({
		specId: spec.specId,
		specRevision: 1,
		triggerKind: "one_off",
		scheduledFor: new Date().toISOString(),
	});
	const claims = store.claimDueRuns({
		nowIso: new Date().toISOString(),
		leaseMs: 30_000,
	});
	expect(claims).toHaveLength(1);
	expect(claims[0]?.run.status).toBe("running");
});
