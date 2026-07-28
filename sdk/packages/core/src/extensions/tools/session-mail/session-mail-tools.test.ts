import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionMailStore } from "../../../services/storage/file-session-mail-store";
import { SessionMessenger } from "../../../session/messaging/session-messenger";
import type { SessionRow } from "../../../session/models/session-row";
import {
	createSessionMailTools,
	SESSION_MAIL_TOOL_NAMES,
} from "./session-mail-tools";

function makeRow(sessionId: string): SessionRow {
	return {
		sessionId,
		source: "test",
		pid: 1,
		startedAt: "2026-07-27T00:00:00.000Z",
		status: "idle" as SessionRow["status"],
		statusLock: 0,
		interactive: true,
		provider: "anthropic",
		model: "claude-opus-5",
		cwd: "/repo",
		workspaceRoot: "/repo",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: `work on ${sessionId}`,
		updatedAt: "2026-07-27T00:00:00.000Z",
	};
}

describe("session mail tools", () => {
	let tempDir: string;
	let messenger: SessionMessenger;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cline-mail-tools-"));
		const rows = [makeRow("alpha"), makeRow("beta")];
		const store = new FileSessionMailStore({ mailDir: tempDir });
		store.init();
		messenger = new SessionMessenger({
			store,
			directory: {
				getSession: async (id) => rows.find((row) => row.sessionId === id),
				listSessions: async () => rows,
			},
			target: { deliver: async () => true },
		});
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function tools(sessionId: string) {
		const list = createSessionMailTools({ messenger, sessionId });
		return new Map(list.map((tool) => [tool.name, tool]));
	}

	it("exposes exactly the declared tool names", () => {
		expect([...tools("alpha").keys()]).toEqual([...SESSION_MAIL_TOOL_NAMES]);
	});

	it("lists peers without the caller", async () => {
		const peers = (await tools("alpha")
			.get("session_list_peers")
			?.execute({}, undefined as never)) as Array<{ sessionId: string }>;
		expect(peers.map((peer) => peer.sessionId)).toEqual(["beta"]);
	});

	it("sends a message and surfaces it in the recipient's inbox", async () => {
		const sent = (await tools("alpha")
			.get("session_send_message")
			?.execute(
				{
					toSessionId: "beta",
					subject: "handoff",
					body: "take the migration",
				},
				undefined as never,
			)) as { deliveredNow: boolean; hopCount: number };

		expect(sent.deliveredNow).toBe(true);
		expect(sent.hopCount).toBe(1);

		const inbox = (await tools("beta")
			.get("session_read_inbox")
			?.execute({}, undefined as never)) as Array<{
			subject: string;
			fromSessionId: string;
		}>;
		expect(inbox).toHaveLength(1);
		expect(inbox[0]).toMatchObject({
			subject: "handoff",
			fromSessionId: "alpha",
		});
	});

	it("reports a refused send with its reason", async () => {
		await expect(
			tools("alpha")
				.get("session_send_message")
				?.execute(
					{ toSessionId: "alpha", subject: "s", body: "b" },
					undefined as never,
				),
		).rejects.toThrow(/self_send/);
	});
});
