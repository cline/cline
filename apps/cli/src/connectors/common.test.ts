import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	__test__,
	readSessionMessageCount,
	readSessionReplyText,
} from "./common";

describe("spawnDetachedConnector", () => {
	it("preserves the connect subcommand when building detached connector args", () => {
		expect(
			__test__.buildDetachedConnectorArgs(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
			),
		).toEqual([
			"connect",
			"telegram",
			"-m",
			"ClineAdapterBot",
			"-k",
			"token-123",
			"-i",
		]);
	});

	it("preserves bun conditions and resolves the cli entrypoint for detached launches", () => {
		const connectorsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(connectorsDir, "../../../../");
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
				"/Users/test/.bun/bin/bun",
				"./apps/cli/src/index.ts",
				["--conditions=development"],
				repoRoot,
				{},
			),
		).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				"--conditions=development",
				resolve(repoRoot, "apps/cli/src/index.ts"),
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-k",
				"token-123",
				"-i",
			],
		});
	});

	it("uses a dynamic connector inspector port for development node launches", () => {
		const connectorsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(connectorsDir, "../../../../");
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot"],
				"/usr/local/bin/node",
				"./apps/cli/src/index.ts",
				[],
				repoRoot,
				{ CLINE_BUILD_ENV: "development" },
			),
		).toEqual({
			launcher: "/usr/local/bin/node",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				resolve(repoRoot, "apps/cli/src/index.ts"),
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-i",
			],
		});
	});

	it("marks detached children and removes the hub-daemon-only environment flag", () => {
		const env = {
			CLINE_BUILD_ENV: "production",
			CLINE_RUN_AS_HUB_DAEMON: "1",
			UNCHANGED: "value",
		};

		expect(
			__test__.buildDetachedConnectorEnv("CLINE_TELEGRAM_CONNECT_CHILD", env),
		).toEqual({
			CLINE_BUILD_ENV: "production",
			CLINE_CONNECTOR_DETACHED_CHILD: "1",
			CLINE_TELEGRAM_CONNECT_CHILD: "1",
			UNCHANGED: "value",
		});
		expect(env.CLINE_RUN_AS_HUB_DAEMON).toBe("1");
	});
});

describe("readSessionReplyText", () => {
	it("reads messages through the hub session client", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "user",
					content: [{ type: "text", text: "question" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "first" }],
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "latest " },
						{ type: "text", text: "reply" },
					],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1"),
		).resolves.toBe("latest reply");
	});

	it("can restrict fallback replies to messages after a known boundary", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "assistant",
					content: [{ type: "text", text: "previous reply" }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "next question" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "current reply" }],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1", {
				minMessageIndex: 1,
			}),
		).resolves.toBe("current reply");
	});

	it("does not read prior assistant replies before the boundary", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "assistant",
					content: [{ type: "text", text: "previous reply" }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "next question" }],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1", {
				minMessageIndex: 1,
			}),
		).resolves.toBeUndefined();
	});

	it("reads the session message count through the hub session client", async () => {
		const client = {
			readMessages: async () => [
				{ role: "user", content: "one" },
				{ role: "assistant", content: "two" },
			],
		};

		await expect(
			readSessionMessageCount(client as never, "session-1"),
		).resolves.toBe(2);
	});
});

describe("tryClaimConnectorStateFile", () => {
	it("claims an empty path and rejects a second live claim", async () => {
		const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");
		const { tryClaimConnectorStateFile } = await import("./common");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		try {
			const first = tryClaimConnectorStateFile(
				statePath,
				(claimId) => ({ claimId, pid: process.pid, userName: "bot" }),
				{
					isRunning: () => true,
					getStartToken: (pid) => `process-${pid}`,
				},
			);
			expect(first).toBeDefined();
			const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
				claimId: string;
				pid: number;
			};
			expect(parsed.claimId).toBe(first?.claimId);
			expect(parsed.pid).toBe(process.pid);

			const second = tryClaimConnectorStateFile(
				statePath,
				(claimId) => ({
					claimId,
					pid: process.pid + 1,
					userName: "bot",
				}),
				{
					isRunning: () => true,
					getStartToken: (pid) => `process-${pid}`,
				},
			);
			expect(second).toBeUndefined();
			expect(JSON.parse(readFileSync(statePath, "utf8")).pid).toBe(process.pid);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("replaces a dead-pid claim", async () => {
		const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
			"node:fs"
		);
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");
		const { tryClaimConnectorStateFile } = await import("./common");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		writeFileSync(
			statePath,
			JSON.stringify({ pid: 1, userName: "stale" }),
			"utf8",
		);
		try {
			const claimed = tryClaimConnectorStateFile(
				statePath,
				(claimId) => ({ claimId, pid: process.pid, userName: "bot" }),
				{
					isRunning: (pid) => pid === process.pid,
					getStartToken: (pid) => `process-${pid}`,
				},
			);
			expect(claimed).toBeDefined();
			expect(JSON.parse(readFileSync(statePath, "utf8")).pid).toBe(process.pid);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allows only one contender to replace the same stale generation", async () => {
		const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
			"node:fs"
		);
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		const stalePayload = `${JSON.stringify({
			claimId: "stale",
			pid: 1,
			userName: "stale",
		})}
`;
		const firstPayload = `${JSON.stringify({
			claimId: "first",
			pid: 2,
			userName: "bot",
		})}
`;
		const secondPayload = `${JSON.stringify({
			claimId: "second",
			pid: 3,
			userName: "bot",
		})}
`;
		writeFileSync(statePath, stalePayload, "utf8");

		try {
			expect(
				__test__.tryReplaceStaleConnectorStateFile(
					statePath,
					stalePayload,
					firstPayload,
					{
						isRunning: () => false,
						getStartToken: (pid) => `process-${pid}`,
					},
				),
			).toBe(true);
			expect(
				__test__.tryReplaceStaleConnectorStateFile(
					statePath,
					stalePayload,
					secondPayload,
					{
						isRunning: () => false,
						getStartToken: (pid) => `process-${pid}`,
					},
				),
			).toBe(false);
			expect(readFileSync(statePath, "utf8")).toBe(firstPayload);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("recovers when a stale-generation guard owner exits before replacement", async () => {
		const { createHash } = await import("node:crypto");
		const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
			"node:fs"
		);
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		const stalePayload = `${JSON.stringify({
			claimId: "stale",
			pid: 1,
			userName: "stale",
		})}
`;
		const replacementPayload = `${JSON.stringify({
			claimId: "replacement",
			pid: 2,
			userName: "bot",
		})}
`;
		const generation = createHash("sha256").update(stalePayload).digest("hex");
		const orphanedGuardPath = `${statePath}.${generation}.claim`;
		writeFileSync(statePath, stalePayload, "utf8");
		writeFileSync(
			orphanedGuardPath,
			`${JSON.stringify(
				{
					claimId: "orphaned",
					pid: 3,
					processStartToken: "process-3",
				},
				null,
				2,
			)}
`,
			"utf8",
		);

		try {
			expect(
				__test__.tryReplaceStaleConnectorStateFile(
					statePath,
					stalePayload,
					replacementPayload,
					{
						isRunning: () => false,
						getStartToken: (pid) => `process-${pid}`,
					},
				),
			).toBe(true);
			expect(readFileSync(statePath, "utf8")).toBe(replacementPayload);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not succeed a live stale-generation guard owner", async () => {
		const { createHash } = await import("node:crypto");
		const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
			"node:fs"
		);
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		const stalePayload = `${JSON.stringify({
			claimId: "stale",
			pid: 1,
			userName: "stale",
		})}
`;
		const replacementPayload = `${JSON.stringify({
			claimId: "replacement",
			pid: 2,
			userName: "bot",
		})}
`;
		const generation = createHash("sha256").update(stalePayload).digest("hex");
		writeFileSync(statePath, stalePayload, "utf8");
		writeFileSync(
			`${statePath}.${generation}.claim`,
			`${JSON.stringify(
				{
					claimId: "live",
					pid: 3,
					processStartToken: "process-3",
				},
				null,
				2,
			)}
`,
			"utf8",
		);

		try {
			expect(
				__test__.tryReplaceStaleConnectorStateFile(
					statePath,
					stalePayload,
					replacementPayload,
					{
						isRunning: (pid) => pid === 3,
						getStartToken: (pid) => `process-${pid}`,
					},
				),
			).toBe(false);
			expect(readFileSync(statePath, "utf8")).toBe(stalePayload);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("recovers when an orphaned guard pid belongs to a different process", async () => {
		const { createHash } = await import("node:crypto");
		const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
			"node:fs"
		);
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");

		const dir = mkdtempSync(join(tmpdir(), "connector-claim-"));
		const statePath = join(dir, "instance.json");
		const stalePayload = `${JSON.stringify({
			claimId: "stale",
			pid: 1,
			userName: "stale",
		})}
`;
		const replacementPayload = `${JSON.stringify({
			claimId: "replacement",
			pid: 2,
			userName: "bot",
		})}
`;
		const generation = createHash("sha256").update(stalePayload).digest("hex");
		writeFileSync(statePath, stalePayload, "utf8");
		writeFileSync(
			`${statePath}.${generation}.claim`,
			`${JSON.stringify(
				{
					claimId: "orphaned",
					pid: 3,
					processStartToken: "original-process-3",
				},
				null,
				2,
			)}
`,
			"utf8",
		);

		try {
			expect(
				__test__.tryReplaceStaleConnectorStateFile(
					statePath,
					stalePayload,
					replacementPayload,
					{
						isRunning: (pid) => pid === 3,
						getStartToken: (pid) =>
							pid === 3 ? "reused-process-3" : `process-${pid}`,
					},
				),
			).toBe(true);
			expect(readFileSync(statePath, "utf8")).toBe(replacementPayload);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("detached connector log rotation", () => {
	it("keeps one generation once the log grows past the cap", () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-connector-log-"));
		const logPath = join(dir, "cline-slack.log");
		writeFileSync(logPath, "x".repeat(__test__.DETACHED_LOG_MAX_BYTES + 1));

		__test__.rotateOversizedLog(logPath);

		expect(existsSync(logPath)).toBe(false);
		expect(readFileSync(`${logPath}.1`, "utf8").length).toBe(
			__test__.DETACHED_LOG_MAX_BYTES + 1,
		);
	});

	it("leaves a small log in place so restarts keep their history", () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-connector-log-"));
		const logPath = join(dir, "cline-slack.log");
		writeFileSync(logPath, "recent failure");

		__test__.rotateOversizedLog(logPath);

		expect(readFileSync(logPath, "utf8")).toBe("recent failure");
		expect(existsSync(`${logPath}.1`)).toBe(false);
	});

	it("does nothing when there is no log yet", () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-connector-log-"));
		expect(() =>
			__test__.rotateOversizedLog(join(dir, "missing.log")),
		).not.toThrow();
	});
});
