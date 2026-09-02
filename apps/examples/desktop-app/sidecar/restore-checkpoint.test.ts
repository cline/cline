import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	persistSessionMessages,
	readSessionMessages,
} from "./session-data/messages";
import type { SidecarContext } from "./types";

const originalDataDir = process.env.CLINE_SESSION_DATA_DIR;
let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-restore-"));
	process.env.CLINE_SESSION_DATA_DIR = dataDir;
});

afterEach(() => {
	if (originalDataDir === undefined) {
		delete process.env.CLINE_SESSION_DATA_DIR;
	} else {
		process.env.CLINE_SESSION_DATA_DIR = originalDataDir;
	}
	rmSync(dataDir, { force: true, recursive: true });
});

describe("restore_checkpoint", () => {
	it("leaves the transcript describing only the restored turns", async () => {
		const sessionId = `restore-source-${Date.now()}`;
		const fullMessages = [
			{ role: "user" as const, content: "append alpha" },
			{ role: "assistant" as const, content: "appended alpha" },
			{ role: "user" as const, content: "append bravo" },
			{ role: "assistant" as const, content: "appended bravo" },
		];
		const restoredMessages = fullMessages.slice(0, 2);

		// The session has already been persisted with both turns, which is what
		// makes the read after a restore prefer the file over the live session.
		persistSessionMessages(sessionId, fullMessages);

		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: { cwd: "/tmp/project" },
						messages: fullMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			pendingApprovals: new Map(),
			pendingQuestions: new Map(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId,
					status: "idle",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
				})),
				// A restore that reuses the source id is what the hub does today.
				restore: vi.fn(async () => ({
					sessionId,
					messages: restoredMessages,
					checkpoint: { ref: "first", createdAt: 1, runCount: 1 },
				})),
				pendingPrompts: { list: vi.fn(async () => []) },
			},
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "restore_checkpoint",
			sessionId,
			checkpointRunCount: 1,
			config: { cwd: "/tmp/project", provider: "cline", model: "test-model" },
		});

		expect(ctx.liveSessions.get(sessionId)?.messages).toEqual(restoredMessages);

		// The webview re-reads the transcript after a restore, and that read
		// prefers the persisted file, so the discarded turns must be gone there
		// too or the transcript contradicts the rolled-back workspace.
		const rows = (await readSessionMessages(ctx, sessionId)) as Array<
			Record<string, unknown>
		>;
		const transcript = JSON.stringify(rows);
		expect(transcript).toContain("alpha");
		expect(transcript).not.toContain("bravo");
	});
});
