import { dirname, resolve } from "node:path";
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
				{ pid: process.pid, userName: "bot" },
				() => true,
			);
			expect(first).toBe(true);
			const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
				pid: number;
			};
			expect(parsed.pid).toBe(process.pid);

			const second = tryClaimConnectorStateFile(
				statePath,
				{ pid: process.pid + 1, userName: "bot" },
				() => true,
			);
			expect(second).toBe(false);
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
		writeFileSync(statePath, JSON.stringify({ pid: 1, userName: "stale" }), "utf8");
		try {
			const claimed = tryClaimConnectorStateFile(
				statePath,
				{ pid: process.pid, userName: "bot" },
				(pid) => pid === process.pid,
			);
			expect(claimed).toBe(true);
			expect(JSON.parse(readFileSync(statePath, "utf8")).pid).toBe(process.pid);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
