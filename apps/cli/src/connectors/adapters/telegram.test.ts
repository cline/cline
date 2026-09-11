import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectTelegramOptions } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_ALREADY_RUNNING_EXIT_CODE } from "../common";
import { handleConnectorUserTurn } from "../connector-host";
import { __test__, telegramConnector } from "./telegram";

const mocks = vi.hoisted(() => ({
	spawnDetachedConnector: vi.fn(),
}));

vi.mock("../common", async (importOriginal) => ({
	...(await importOriginal<typeof import("../common")>()),
	spawnDetachedConnector: mocks.spawnDetachedConnector,
}));

const parseTelegramArgs = (rawArgs: string[]): ConnectTelegramOptions =>
	(
		telegramConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectTelegramOptions;
		}
	).parseArgs(rawArgs);

const originalClineDataDir = process.env.CLINE_DATA_DIR;
const tempDataDirs: string[] = [];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.spawnDetachedConnector.mockReturnValue(42);
});

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

	it("validates a token before reporting its connector as already running", async () => {
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
		const fetchImpl = vi.fn(async () =>
			Response.json({
				ok: true,
				result: { username: "resolved_bot" },
			}),
		);
		vi.stubGlobal("fetch", fetchImpl);
		const output: string[] = [];
		const errors: string[] = [];

		await expect(
			telegramConnector.run(
				["--bot-token", "123:test", "--cwd", "/tmp/work"],
				{
					writeln: (text = "") => output.push(text),
					writeErr: (text) => errors.push(text),
				},
				{
					setPersistenceArgs: vi.fn(),
					setPersistenceInstanceId: vi.fn(),
				},
			),
		).resolves.toBe(CONNECT_ALREADY_RUNNING_EXIT_CODE);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(errors).toEqual([]);
		expect(output).toEqual([
			`[telegram] connector already running pid=${process.pid} rpc=127.0.0.1:54321`,
		]);
	});

	it("reports the resolved bot username in persistence args", async () => {
		const dataDir = useTempClineDataDir();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						ok: true,
						result: { username: "resolved_bot" },
					}),
				);
			}),
		);
		const setPersistenceArgs = vi.fn();
		const setPersistenceInstanceId = vi.fn();
		mocks.spawnDetachedConnector.mockImplementation(() => {
			const connectorDir = join(dataDir, "connectors", "telegram");
			mkdirSync(connectorDir, { recursive: true });
			writeFileSync(
				join(connectorDir, "resolved_bot.json"),
				JSON.stringify({
					botUsername: "resolved_bot",
					pid: process.pid,
				}),
			);
			return process.pid;
		});

		await expect(
			telegramConnector.run(
				["--bot-token", "123:test", "--cwd", "/tmp/work"],
				{
					writeln: () => {},
					writeErr: () => {},
				},
				{ setPersistenceArgs, setPersistenceInstanceId },
			),
		).resolves.toBe(0);

		expect(setPersistenceArgs).toHaveBeenCalledWith([
			"--bot-token",
			"123:test",
			"--cwd",
			"/tmp/work",
			"--bot-username",
			"resolved_bot",
		]);
		expect(setPersistenceInstanceId).toHaveBeenCalledWith("resolved_bot");
		expect(mocks.spawnDetachedConnector).toHaveBeenCalled();
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

type SlashTestState = Record<string, unknown>;

function createSlashTestThread(input: {
	id: string;
	channelId: string;
	isDM: boolean;
	initialState?: SlashTestState;
}) {
	let state: SlashTestState = { ...(input.initialState ?? {}) };
	const posts: unknown[] = [];
	let subscribed = false;
	const thread = {
		id: input.id,
		channelId: input.channelId,
		isDM: input.isDM,
		get state() {
			return Promise.resolve(state);
		},
		async setState(nextState: SlashTestState) {
			state = { ...nextState };
		},
		async subscribe() {
			subscribed = true;
		},
		async post(message: unknown) {
			posts.push(message);
			const sentMessage = {
				edit: async (nextMessage: unknown) => {
					posts.push(nextMessage);
					return sentMessage;
				},
				delete: async () => undefined,
			};
			return sentMessage;
		},
		async startTyping() {},
		toJSON() {
			return {
				id: input.id,
				channelId: input.channelId,
				isDM: input.isDM,
				state,
			};
		},
	};
	return {
		thread,
		posts,
		getState: () => state,
		isSubscribed: () => subscribed,
	};
}

function slashTestStartRequest() {
	return {
		enableTools: false,
		autoApproveTools: false,
		cwd: "/tmp/work",
		workspaceRoot: "/tmp/work",
		systemPrompt: "system",
		provider: "cline",
		model: "test-model",
		mode: "act",
	};
}

describe("telegram slash command delivery", () => {
	it("receives bot_command updates intercepted by the telegram chat library", async () => {
		// The Telegram Bot API tags any leading-slash message with a
		// `bot_command` entity, and @chat-adapter/telegram diverts those
		// updates away from the mention/subscribed-message handlers. This
		// pins the delivery contract: an intercepted update must still reach
		// the connector turn handler through the slash-command path.
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ ok: true, result: {} }), {
						status: 200,
					}),
			),
		);
		const { createTelegramAdapter } = await import("@chat-adapter/telegram");
		const { Chat, ConsoleLogger } = await import("chat");
		const { InMemoryStateAdapter } = await import("../stores/memory-state");
		const telegram = createTelegramAdapter({
			mode: "polling",
			botToken: "123456:TEST-TOKEN",
			userName: "test_bot",
			logger: new ConsoleLogger("error", "telegram-slash-test"),
		});
		const bot = new Chat({
			userName: "test_bot",
			adapters: { telegram },
			state: new InMemoryStateAdapter(),
			logger: new ConsoleLogger("error", "telegram-slash-test"),
		});
		// bot.initialize() assigns this reference before polling starts; set
		// it directly to avoid the real getMe/long-polling network calls.
		(telegram as unknown as { chat: unknown }).chat = bot;

		const dir = mkdtempSync(join(tmpdir(), "cline-telegram-slash-"));
		tempDataDirs.push(dir);
		const turns: Array<{ threadId: string; isDM: boolean; text: string }> = [];
		bot.onSlashCommand(
			__test__.createTelegramSlashCommandHandler({
				bot,
				bindingsPath: join(dir, "threads.json"),
				baseStartRequest: slashTestStartRequest() as never,
				handleTurn: async (thread, text) => {
					turns.push({ threadId: thread.id, isDM: thread.isDM, text });
				},
			}) as never,
		);

		const completions: Promise<unknown>[] = [];
		(
			telegram as unknown as {
				processUpdate: (update: unknown, options?: unknown) => void;
			}
		).processUpdate(
			{
				update_id: 1,
				message: {
					message_id: 42,
					date: Math.floor(Date.now() / 1000),
					chat: { id: 555, type: "private" },
					from: {
						id: 999,
						is_bot: false,
						first_name: "Alice",
						username: "alice",
					},
					text: "/clear",
					entities: [{ type: "bot_command", offset: 0, length: 6 }],
				},
			},
			{
				waitUntil: (task: Promise<unknown>) =>
					completions.push(task.catch(() => undefined)),
			},
		);
		await Promise.all(completions);
		await vi.waitFor(() => {
			expect(turns).toHaveLength(1);
		});

		expect(turns[0]).toEqual({
			threadId: "telegram:555",
			isDM: true,
			text: "/clear",
		});
	});

	it("routes intercepted slash commands into the connector turn handler", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-telegram-slash-"));
		tempDataDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, isSubscribed, getState } = createSlashTestThread({
			id: "telegram:12345",
			channelId: "telegram:12345",
			isDM: true,
		});
		const botThread = vi.fn(() => thread);
		const handleTurn = vi.fn(async () => undefined);
		const handler = __test__.createTelegramSlashCommandHandler({
			bot: { thread: botThread } as never,
			bindingsPath,
			baseStartRequest: slashTestStartRequest() as never,
			handleTurn: handleTurn as never,
		});

		await handler({
			channel: { id: "telegram:12345" },
			command: "/clear",
			text: "",
			raw: {
				message_id: 7,
				chat: { id: 12345, type: "private" },
				from: { id: 999, username: "alice", first_name: "Alice" },
				text: "/clear",
				entities: [{ type: "bot_command", offset: 0, length: 6 }],
			},
		});

		expect(botThread).toHaveBeenCalledWith("telegram:12345");
		expect(isSubscribed()).toBe(true);
		expect(handleTurn).toHaveBeenCalledWith(thread, "/clear");
		expect(getState().participantKey).toBe("telegram:id:999");
	});

	it("preserves group-chat bot addressing in the forwarded command text", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-telegram-slash-"));
		tempDataDirs.push(dir);
		const { thread } = createSlashTestThread({
			id: "telegram:-100200",
			channelId: "telegram:-100200",
			isDM: false,
		});
		const handleTurn = vi.fn(async () => undefined);
		const handler = __test__.createTelegramSlashCommandHandler({
			bot: { thread: () => thread } as never,
			bindingsPath: join(dir, "threads.json"),
			baseStartRequest: slashTestStartRequest() as never,
			handleTurn: handleTurn as never,
		});

		// The chat adapter strips "@test_bot" into command targeting before
		// invoking slash handlers; the raw message text keeps it so the
		// connector host can enforce group addressing rules.
		await handler({
			channel: { id: "telegram:-100200" },
			command: "/tools",
			text: "on",
			raw: {
				message_id: 8,
				chat: { id: -100200, type: "supergroup" },
				from: { id: 999, username: "alice" },
				text: "/tools@test_bot on",
				entities: [{ type: "bot_command", offset: 0, length: 15 }],
			},
		});

		expect(handleTurn).toHaveBeenCalledWith(thread, "/tools@test_bot on");
	});

	it("falls back to the parsed command when the raw payload has no text", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-telegram-slash-"));
		tempDataDirs.push(dir);
		const { thread } = createSlashTestThread({
			id: "telegram:12345",
			channelId: "telegram:12345",
			isDM: true,
		});
		const handleTurn = vi.fn(async () => undefined);
		const handler = __test__.createTelegramSlashCommandHandler({
			bot: { thread: () => thread } as never,
			bindingsPath: join(dir, "threads.json"),
			baseStartRequest: slashTestStartRequest() as never,
			handleTurn: handleTurn as never,
		});

		await handler({
			channel: { id: "telegram:12345" },
			command: "/cwd",
			text: "/tmp",
			raw: undefined,
		});

		expect(handleTurn).toHaveBeenCalledWith(thread, "/cwd /tmp");
	});

	it("delivers intercepted slash commands to the chat command host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-telegram-slash-"));
		tempDataDirs.push(dir);
		const bindingsPath = join(dir, "threads.json");
		const { thread, posts } = createSlashTestThread({
			id: "telegram:777",
			channelId: "telegram:777",
			isDM: true,
			initialState: {
				sessionId: "session-1",
				participantKey: "telegram:id:999",
				participantLabel: "alice",
				welcomeSentAt: "2026-03-17T00:00:00.000Z",
			},
		});
		const stopRuntimeSession = vi.fn(async () => undefined);
		const deleteSession = vi.fn(async () => undefined);
		const baseStartRequest = slashTestStartRequest();
		const handler = __test__.createTelegramSlashCommandHandler({
			bot: { thread: () => thread } as never,
			bindingsPath,
			baseStartRequest: baseStartRequest as never,
			handleTurn: (async (
				turnThread: typeof thread,
				text: string,
			): Promise<void> => {
				await handleConnectorUserTurn({
					thread: turnThread as never,
					text,
					client: { stopRuntimeSession, deleteSession } as never,
					pendingApprovals: new Map(),
					baseStartRequest: baseStartRequest as never,
					explicitSystemPrompt: undefined,
					clientId: "client-1",
					logger: {
						core: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
					} as never,
					transport: "telegram",
					botUserName: "test_bot",
					requestStop: vi.fn(),
					bindingsPath,
					systemRules: "rules",
					errorLabel: "Telegram",
					getSessionMetadata: () => ({}),
					reusedLogMessage: "reused",
				});
			}) as never,
		});

		await handler({
			channel: { id: "telegram:777" },
			command: "/clear",
			text: "",
			raw: {
				message_id: 9,
				chat: { id: 777, type: "private" },
				from: { id: 999, username: "alice" },
				text: "/clear",
				entities: [{ type: "bot_command", offset: 0, length: 6 }],
			},
		});

		expect(deleteSession).toHaveBeenCalledWith("session-1", true);
		expect(posts).toContainEqual({ raw: "Started a fresh session." });
	});
});
