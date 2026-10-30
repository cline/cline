import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getProcessStartToken,
	SqliteSessionStore,
	type SessionRecord,
} from "@cline/core";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";
import { expect, it, vi } from "vitest";
import { cleanupStaleSideConversations } from "./lifecycle";

it("cleans dead and reused process owners without deleting another live app's sides or legacy history", async () => {
	const previous = resolveClineDir();
	const directory = mkdtempSync(join(tmpdir(), "desktop-side-owners-"));
	setClineDir(directory);
	vi.stubEnv("CLINE_KANBAN_DATA_DIR", join(directory, "logs"));
	const store = new SqliteSessionStore();
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	try {
		await once(child, "spawn");
		if (!child.pid) throw new Error("test owner did not start");
		const childToken = getProcessStartToken(child.pid);
		if (!childToken) throw new Error("test owner identity unavailable");
		const base: SessionRecord = {
			sessionId: "",
			pid: process.pid,
			isSubagent: false,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			interactive: true,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			source: "desktop",
			status: "idle",
			provider: "test",
			model: "test",
			cwd: directory,
			workspaceRoot: directory,
		};
		for (const [sessionId, owner] of [
			[
				"live-other-app",
				{ runId: "other", pid: child.pid, startToken: childToken },
			],
			[
				"reused-pid",
				{
					runId: "prior",
					pid: child.pid,
					startToken: "different-process-start",
				},
			],
			["legacy-side", undefined],
		] as const) {
			store.create({
				...base,
				sessionId,
				metadata: {
					desktopSideConversation: {
						version: 1,
						owner,
						parentSessionId: "main",
						capturedAt: new Date().toISOString(),
						sourceMessageCount: 0,
						includedMessageCount: 0,
						omittedMessageCount: 0,
						omittedMediaCount: 0,
					},
				},
			});
		}
		store.create({ ...base, sessionId: "main" });
		let failDeletion = true;
		const cleanupError = new Error("Temporary file is locked");
		const onError = vi.fn();
		const manager = {
			delete: vi.fn(async (id: string) => {
				if (failDeletion) throw cleanupError;
				return store.delete(id, true);
			}),
		};
		await cleanupStaleSideConversations(manager, onError);
		expect(manager.delete.mock.calls.map(([id]) => id)).toEqual(["reused-pid"]);
		expect(onError).toHaveBeenCalledExactlyOnceWith(cleanupError);
		expect(store.get("reused-pid")).toBeDefined();
		failDeletion = false;
		expect(store.get("live-other-app")).toBeDefined();
		expect(store.get("legacy-side")).toBeDefined();
		const exited = once(child, "exit");
		child.kill();
		await exited;
		await cleanupStaleSideConversations(manager, onError);
		expect(store.get("live-other-app")).toBeUndefined();
		expect(store.get("legacy-side")).toBeDefined();
		expect(store.get("main")).toBeDefined();
		await cleanupStaleSideConversations(manager, onError);
		expect(manager.delete).toHaveBeenCalledTimes(3);
		expect(store.get("reused-pid")).toBeUndefined();
	} finally {
		child.kill();
		store.close();
		setClineDir(previous);
		vi.unstubAllEnvs();
		rmSync(directory, { recursive: true, force: true });
	}
});
