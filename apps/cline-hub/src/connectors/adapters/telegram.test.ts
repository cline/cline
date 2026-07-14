import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectTelegramOptions } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__, telegramConnector } from "./telegram";

const parseTelegramArgs = (rawArgs: string[]): ConnectTelegramOptions =>
	(
		telegramConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectTelegramOptions;
		}
	).parseArgs(rawArgs);

const originalClineDataDir = process.env.CLINE_DATA_DIR;
const tempDataDirs: string[] = [];

function useTempClineDataDir(): string {
	const dataDir = mkdtempSync(join(tmpdir(), "cline-telegram-test-"));
	tempDataDirs.push(dataDir);
	process.env.CLINE_DATA_DIR = dataDir;
	return dataDir;
}

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalClineDataDir === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = originalClineDataDir;
	}
	for (const dir of tempDataDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("telegramConnector", () => {
	it("honors --no-tools", () => {
		const options = parseTelegramArgs([
			"--bot-username",
			"test_bot",
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
			"--no-tools",
		]);

		expect(options.enableTools).toBe(false);
	});

	it("enables tools by default", () => {
		const options = parseTelegramArgs([
			"--bot-username",
			"test_bot",
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
		]);

		expect(options.enableTools).toBe(true);
	});

	it("builds an authorization hook from --allowed-user-id", () => {
		const options = parseTelegramArgs([
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
			"--allowed-user-id",
			"1201547643",
		]);

		expect(options.hookCommand).toBe(
			`jq -r ".payload.actor.participantKey" | grep -qx "telegram:id:1201547643" && echo '{"action":"allow"}' || echo '{"action":"deny","message":"unauthorized","reason":"not_on_allowlist"}'`,
		);
	});

	it("rejects unsafe --allowed-user-id values", () => {
		expect(() =>
			parseTelegramArgs([
				"--bot-token",
				"123:test",
				"--cwd",
				"/tmp/work",
				"--allowed-user-id",
				"123; rm -rf /",
			]),
		).toThrow("digits only");
	});

	it("rejects mixing --allowed-user-id with --hook-command", () => {
		expect(() =>
			parseTelegramArgs([
				"--bot-token",
				"123:test",
				"--cwd",
				"/tmp/work",
				"--allowed-user-id",
				"1201547643",
				"--hook-command",
				"echo noop",
			]),
		).toThrow("either --allowed-user-id or --hook-command");
	});

	it("rejects mixing --allowed-user-id with the hook command env var", () => {
		const originalHookCommand = process.env.CLINE_CONNECT_HOOK_COMMAND;
		process.env.CLINE_CONNECT_HOOK_COMMAND = "echo noop";
		try {
			expect(() =>
				parseTelegramArgs([
					"--bot-token",
					"123:test",
					"--cwd",
					"/tmp/work",
					"--allowed-user-id",
					"1201547643",
				]),
			).toThrow("either --allowed-user-id or --hook-command");
		} finally {
			if (originalHookCommand === undefined) {
				delete process.env.CLINE_CONNECT_HOOK_COMMAND;
			} else {
				process.env.CLINE_CONNECT_HOOK_COMMAND = originalHookCommand;
			}
		}
	});

	it("does not require the bot username", () => {
		const options = parseTelegramArgs([
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
		]);

		expect(options.botUsername).toBeUndefined();
		expect(options.botToken).toBe("123:test");
	});

	it("normalizes an explicit bot username", () => {
		const options = parseTelegramArgs([
			"--bot-username",
			"  @test_bot  ",
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
		]);

		expect(options.botUsername).toBe("test_bot");
	});

	it("does not call getMe when the token-only connector is already running", async () => {
		const dataDir = useTempClineDataDir();
		const connectorDir = join(dataDir, "connectors", "telegram");
		mkdirSync(connectorDir, { recursive: true });
		writeFileSync(
			join(connectorDir, "resolved_bot.json"),
			JSON.stringify({
				botUsername: "resolved_bot",
				botId: "123",
				pid: process.pid,
				rpcAddress: "127.0.0.1:54321",
				startedAt: new Date().toISOString(),
			}),
		);
		const fetchImpl = vi.fn(async () => {
			throw new Error("unexpected getMe call");
		});
		vi.stubGlobal("fetch", fetchImpl);
		const output: string[] = [];
		const errors: string[] = [];

		await expect(
			telegramConnector.run(["--bot-token", "123:test", "--cwd", "/tmp/work"], {
				writeln: (text = "") => output.push(text),
				writeErr: (text) => errors.push(text),
			}),
		).resolves.toBe(0);

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(errors).toEqual([]);
		expect(output).toEqual([
			`[telegram] connector already running pid=${process.pid} rpc=127.0.0.1:54321`,
		]);
	});
});

describe("telegram bot username resolution", () => {
	it("reads the public Telegram bot id from a token", () => {
		expect(__test__.readTelegramBotId("123456:secret")).toBe("123456");
		expect(__test__.readTelegramBotId("not-a-token")).toBeUndefined();
	});

	it("uses the configured username without calling Telegram", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("unexpected fetch");
		});

		await expect(
			__test__.resolveTelegramBotUsername(
				{
					botToken: "123:test",
					botUsername: "@configured_bot",
					cwd: "/tmp/work",
					mode: "act",
					interactive: true,
					enableTools: true,
					rpcAddress: "127.0.0.1:0",
				},
				fetchImpl,
			),
		).resolves.toBe("configured_bot");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("fetches the username from Telegram getMe when omitted", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					ok: true,
					result: { username: "resolved_bot" },
				}),
			);
		});

		await expect(
			__test__.fetchTelegramBotUsername("123:test", fetchImpl),
		).resolves.toBe("resolved_bot");
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.telegram.org/bot123:test/getMe",
		);
	});

	it("surfaces Telegram getMe failures", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					ok: false,
					description: "Unauthorized",
				}),
				{ status: 401, statusText: "Unauthorized" },
			);
		});

		await expect(
			__test__.fetchTelegramBotUsername("bad-token", fetchImpl),
		).rejects.toThrow("Telegram getMe failed");
	});
});

describe("telegram participant resolution", () => {
	it("uses the stable numeric Telegram user id when username is also present", () => {
		const result = __test__.resolveTelegramParticipant({
			message: {
				from: {
					id: 1201547643,
					username: "AraFatKatze",
					first_name: "Ara",
				},
			},
		});

		expect(result).toEqual({
			key: "telegram:id:1201547643",
			label: "arafatkatze",
		});
	});

	it("falls back to username when Telegram does not provide a numeric user id", () => {
		const result = __test__.resolveTelegramParticipant({
			message: {
				from: {
					username: "Alice",
				},
			},
		});

		expect(result).toEqual({
			key: "telegram:user:alice",
			label: "alice",
		});
	});

	it("accepts string numeric user ids from raw Telegram payloads", () => {
		const result = __test__.resolveTelegramParticipant({
			message: {
				from: {
					id: "1201547643",
					username: "arafatkatze",
				},
			},
		});

		expect(result?.key).toBe("telegram:id:1201547643");
	});
});

describe("telegram binding lookup", () => {
	it("falls back to channel identity when a restarted connector gets a new thread id", () => {
		const result = __test__.findBindingForThread(
			{
				legacy_thread_id: {
					channelId: "chat-123",
					isDM: true,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1", cwd: "/tmp/work" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "new_thread_id",
				channelId: "chat-123",
				isDM: true,
			},
		);

		expect(result).toEqual({
			key: "legacy_thread_id",
			binding: {
				channelId: "chat-123",
				isDM: true,
				serializedThread: "{}",
				sessionId: "sess-1",
				state: { sessionId: "sess-1", cwd: "/tmp/work" },
				updatedAt: "2026-03-17T00:00:00.000Z",
			},
		});
	});

	it("prefers an exact thread id match over a channel fallback", () => {
		const result = __test__.findBindingForThread(
			{
				current_thread_id: {
					channelId: "chat-123",
					isDM: true,
					serializedThread: "{}",
					sessionId: "sess-2",
					state: { sessionId: "sess-2" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
				legacy_thread_id: {
					channelId: "chat-123",
					isDM: true,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "current_thread_id",
				channelId: "chat-123",
				isDM: true,
			},
		);

		expect(result?.key).toBe("current_thread_id");
		expect(result?.binding.sessionId).toBe("sess-2");
	});

	it("does not reuse a binding by participant key across different chats", () => {
		const result = __test__.findBindingForThread(
			{
				"telegram:user:alice": {
					channelId: "chat-123",
					isDM: true,
					participantKey: "telegram:user:alice",
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						participantKey: "telegram:user:alice",
						participantLabel: "alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "new_thread_id",
				channelId: "chat-999",
				isDM: true,
				participantKey: "telegram:user:alice",
			},
		);

		expect(result).toBeUndefined();
	});
});
