import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import { SessionSource } from "../types/common";
import { CoreSessionService } from "./session-service";

describe("UnifiedSessionPersistenceService", () => {
	const tempDirs: string[] = [];
	const stores: Array<SqliteSessionStore> = [];

	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reconciles dead running sessions into failed manifests with terminal markers", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "stale-session-reconcile-"));
		tempDirs.push(sessionsDir);

		const store = new SqliteSessionStore({ sessionsDir });
		stores.push(store);
		const service = new CoreSessionService(store);
		const sessionId = "stale-root-session";
		const artifacts = await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: 999_999_999,
			interactive: false,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			prompt: "hello",
			startedAt: "2026-01-01T00:00:00.000Z",
		});

		const reconciled = await service.reconcileDeadSessions();
		expect(reconciled).toBe(1);

		const rows = await service.listSessions(10);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sessionId,
			status: "failed",
			exitCode: 1,
		});
		expect(rows[0]?.endedAt).toBeTruthy();

		const manifest = JSON.parse(
			readFileSync(artifacts.manifestPath, "utf8"),
		) as Record<string, unknown>;
		expect(manifest.status).toBe("failed");
		expect(manifest.exit_code).toBe(1);
		expect(manifest.ended_at).toBeTruthy();
		expect(manifest.metadata).toMatchObject({
			terminal_marker: "failed_external_process_exit",
			terminal_marker_pid: 999_999_999,
			terminal_marker_source: "stale_session_reconciler",
		});
		expect(
			(manifest.metadata as Record<string, unknown>).terminal_marker_at,
		).toBeTruthy();

		expect(existsSync(artifacts.hookPath)).toBe(true);
		expect(existsSync(artifacts.transcriptPath)).toBe(true);
		expect(readFileSync(artifacts.hookPath, "utf8")).toContain(
			'"hookName":"session_shutdown"',
		);
		expect(readFileSync(artifacts.hookPath, "utf8")).toContain(
			'"reason":"failed_external_process_exit"',
		);
		expect(readFileSync(artifacts.transcriptPath, "utf8")).toContain(
			"[shutdown] failed_external_process_exit",
		);
	}, 15_000);
});
