import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { sharedSessionMessagesPath } from "./paths";
import {
	exportSessionHistoryFile,
	resolveSessionHistoryFilePath,
} from "./session-export";
import type { SidecarContext } from "./types";

let sandbox: string;
let destination: string;

const HISTORY = `${JSON.stringify(
	{ messages: [{ role: "user", content: "hello" }], ts: 1 },
	null,
	2,
)}\n`;

function writeHistory(sessionId: string, content = HISTORY): string {
	const path = sharedSessionMessagesPath(sessionId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	return path;
}

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "cline-session-export-"));
	destination = join(sandbox, "exports");
	mkdirSync(destination);
	vi.stubEnv("CLINE_DIR", join(sandbox, "cline-dir"));
	vi.stubEnv("CLINE_SESSION_DATA_DIR", join(sandbox, "sessions"));
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(sandbox, { recursive: true, force: true });
});

describe("exportSessionHistoryFile", () => {
	it("copies the on-disk history file unchanged to the chosen file path", async () => {
		const sourcePath = writeHistory("session-1");
		const target = join(destination, "my renamed export.json");

		const result = await exportSessionHistoryFile({
			sessionId: "session-1",
			destinationPath: target,
		});

		expect(result).toEqual({
			sourcePath,
			path: target,
			fileName: "my renamed export.json",
		});
		expect(readFileSync(target, "utf8")).toBe(HISTORY);
		// Export is a copy: the stored history stays where it was.
		expect(readFileSync(sourcePath, "utf8")).toBe(HISTORY);
		expect(readdirSync(destination)).toEqual(["my renamed export.json"]);
	});

	it("replaces an existing file the save dialog already confirmed", async () => {
		writeHistory("session-1");
		const target = join(destination, "session-1.messages.json");
		writeFileSync(target, "older export");

		await exportSessionHistoryFile({
			sessionId: "session-1",
			destinationPath: target,
		});

		expect(readFileSync(target, "utf8")).toBe(HISTORY);
	});

	it("refuses to export a session onto its own history file", async () => {
		const sourcePath = writeHistory("session-1");

		await expect(
			exportSessionHistoryFile({
				sessionId: "session-1",
				destinationPath: sourcePath,
			}),
		).rejects.toThrow("Choose a different location");
		expect(readFileSync(sourcePath, "utf8")).toBe(HISTORY);
	});

	it("uses the recorded path for a transcript stored outside its own directory", async () => {
		const recorded = join(sandbox, "sessions", "root", "agent", "child.json");
		mkdirSync(dirname(recorded), { recursive: true });
		writeFileSync(recorded, HISTORY);

		expect(resolveSessionHistoryFilePath("child", [null, recorded])).toBe(
			recorded,
		);
		const result = await exportSessionHistoryFile({
			sessionId: "child",
			destinationPath: join(destination, "child-export.json"),
			recordedPaths: [recorded],
		});
		expect(readFileSync(result.path, "utf8")).toBe(HISTORY);
	});

	it("rejects a session with no history on disk", async () => {
		await expect(
			exportSessionHistoryFile({
				sessionId: "missing",
				destinationPath: join(destination, "missing.json"),
			}),
		).rejects.toThrow("No session history is stored on disk");
		expect(readdirSync(destination)).toEqual([]);
	});

	it("rejects unusable destinations and unsafe session ids", async () => {
		writeHistory("session-1");
		await expect(
			exportSessionHistoryFile({
				sessionId: "session-1",
				destinationPath: join(sandbox, "nope", "out.json"),
			}),
		).rejects.toThrow("Destination folder not found");
		await expect(
			exportSessionHistoryFile({
				sessionId: "session-1",
				destinationPath: destination,
			}),
		).rejects.toThrow("Destination is a folder");
		await expect(
			exportSessionHistoryFile({
				sessionId: "session-1",
				destinationPath: "  ",
			}),
		).rejects.toThrow("destination path is required");
		await expect(
			exportSessionHistoryFile({
				sessionId: "../session-1",
				destinationPath: join(destination, "out.json"),
			}),
		).rejects.toThrow("invalid session id");
	});
});

describe("export_chat_session_history command", () => {
	function context(kind: "local" | "ssh") {
		return {
			activeEnvironmentId: "local",
			liveSessions: new Map(),
			sessionEnvironmentIds: new Map(),
			runtimeBindings: new Map([
				["local", { kind, environmentId: "local", sessionManager: {} }],
			]),
			logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
		} as unknown as SidecarContext;
	}

	it("exports a local session to the chosen file", async () => {
		writeHistory("session-1");
		const target = join(destination, "renamed.json");

		const result = (await handleCommand(
			context("local"),
			"export_chat_session_history",
			{
				environmentId: "local",
				sessionId: "session-1",
				destinationPath: target,
			},
		)) as { path: string };

		expect(result.path).toBe(target);
		expect(readFileSync(result.path, "utf8")).toBe(HISTORY);
	});

	it("refuses sessions whose history is not on this machine", async () => {
		writeHistory("session-1");

		const target = join(destination, "renamed.json");
		await expect(
			handleCommand(context("ssh"), "export_chat_session_history", {
				environmentId: "local",
				sessionId: "session-1",
				destinationPath: target,
			}),
		).rejects.toThrow("Only local sessions can be exported.");
		expect(existsSync(target)).toBe(false);
	});
});
