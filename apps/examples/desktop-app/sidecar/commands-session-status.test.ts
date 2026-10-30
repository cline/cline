import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@cline/core";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext, handleCoreSessionEvent } from "./context";
import { localRuntimeContext } from "./session-test-helpers";

let directory: string;
let previousClineDir: string;
let store: SqliteSessionStore;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "desktop-session-status-"));
	previousClineDir = resolveClineDir();
	setClineDir(directory);
	vi.stubEnv("CLINE_SESSION_DATA_DIR", join(directory, "sessions"));
	store = new SqliteSessionStore();
});
afterEach(() => {
	store.close();
	setClineDir(previousClineDir);
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

it("keeps an announced queued turn active while its runtime record is still idle", async () => {
	const sessionId = "queued-session";
	const record = { sessionId, status: "idle", cwd: directory };
	const ctx = Object.assign(
		createSidecarContext(directory),
		localRuntimeContext(
			{ get: vi.fn(async () => record) },
			{ sessionIds: [sessionId], workspaceRoot: directory },
		),
	);
	ctx.liveSessions.set(sessionId, {
		config: { cwd: directory },
		messages: [],
		promptsInQueue: [],
		busy: false,
		status: "idle",
		startedAt: Date.now(),
	});
	const read = () =>
		handleCommand(ctx, "get_discovered_session", {
			sessionId,
			environmentId: "local",
		});
	handleCoreSessionEvent(ctx, {
		type: "pending_prompt_submitted",
		payload: {
			sessionId,
			id: "queued",
			prompt: "Question",
			delivery: "queue",
			attachmentCount: 0,
		},
	});
	await expect(read()).resolves.toMatchObject({ status: "running" });
	record.status = "failed";
	await expect(read()).resolves.toMatchObject({ status: "failed" });
	record.status = "idle";
	handleCoreSessionEvent(ctx, {
		type: "agent_event",
		payload: {
			sessionId,
			event: {
				type: "done",
				reason: "completed",
				text: "Answer",
				iterations: 1,
			},
		},
	});
	await expect(read()).resolves.toMatchObject({ status: "idle" });
});
