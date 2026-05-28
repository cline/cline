import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectDiscordOptions } from "@cline/shared";
import type { Thread } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBindings, writeBindings } from "../thread-bindings";
import { __test__, discordConnector } from "./discord";

const parseDiscordArgs = (rawArgs: string[]): ConnectDiscordOptions =>
	(
		discordConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectDiscordOptions;
		}
	).parseArgs(rawArgs);

type TestDiscordState = {
	sessionId?: string;
	enableTools?: boolean;
	autoApproveTools?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	systemPrompt?: string;
	participantKey?: string;
	participantLabel?: string;
	welcomeSentAt?: string;
};

function createThread(
	initialState: TestDiscordState,
): Thread<TestDiscordState> {
	let state = { ...initialState };
	return {
		id: "discord:guild:channel:thread",
		channelId: "discord:guild:channel",
		isDM: false,
		get state() {
			return Promise.resolve(state);
		},
		async setState(nextState: TestDiscordState) {
			state = { ...nextState };
		},
		toJSON() {
			return {
				id: "discord:guild:channel:thread",
				channelId: "discord:guild:channel",
				isDM: false,
				state,
			};
		},
	} as unknown as Thread<TestDiscordState>;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("discordConnector", () => {
	it("accepts the documented app id and token aliases", () => {
		const options = parseDiscordArgs([
			"--app-id",
			"app-123",
			"--token",
			"bot-token",
			"--public-key",
			"public-key",
			"--base-url",
			"https://example.test",
		]);

		expect(options.applicationId).toBe("app-123");
		expect(options.botToken).toBe("bot-token");
		expect(options.publicKey).toBe("public-key");
		expect(options.baseUrl).toBe("https://example.test");
	});

	it("keeps accepting the explicit application id and bot token options", () => {
		const options = parseDiscordArgs([
			"--application-id",
			"app-456",
			"--bot-token",
			"other-token",
			"--public-key",
			"public-key",
			"--owner-user-id",
			"owner-123",
		]);

		expect(options.applicationId).toBe("app-456");
		expect(options.botToken).toBe("other-token");
		expect(options.ownerUserId).toBe("owner-123");
		expect(options.allowBotAuthors).toBe(true);
	});

	it("can explicitly ignore bot-authored Discord messages", () => {
		const options = parseDiscordArgs([
			"--application-id",
			"app-456",
			"--bot-token",
			"other-token",
			"--public-key",
			"public-key",
			"--ignore-bot-authors",
		]);

		expect(options.allowBotAuthors).toBe(false);
	});

	it("builds empty-runtime fallback replies from the current Discord turn", async () => {
		const priorMessages = [
			{
				role: "user",
				content: [{ type: "text", text: "previous question" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Previous reply." }],
			},
		];
		const currentMessages = [
			...priorMessages,
			{
				role: "user",
				content: [{ type: "text", text: "read README.md" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary from saved session." }],
			},
		];
		const client = {
			readMessages: vi
				.fn()
				.mockResolvedValueOnce(priorMessages)
				.mockResolvedValueOnce(currentMessages),
		};

		const resolveFallbackText =
			await __test__.createDiscordEmptyRuntimeReplyResolver({
				client: client as never,
				sessionId: "session-1",
			});

		await expect(resolveFallbackText?.()).resolves.toBe(
			"Summary from saved session.",
		);
		expect(client.readMessages).toHaveBeenCalledTimes(2);
	});

	it("does not reuse prior Discord replies as empty-runtime fallback text", async () => {
		const priorMessages = [
			{
				role: "user",
				content: [{ type: "text", text: "previous question" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Previous reply." }],
			},
		];
		const currentMessages = [
			...priorMessages,
			{
				role: "user",
				content: [{ type: "text", text: "run ls /tmp" }],
			},
			{
				role: "tool",
				content: [{ type: "text", text: "tool output" }],
			},
		];
		const client = {
			readMessages: vi
				.fn()
				.mockResolvedValueOnce(priorMessages)
				.mockResolvedValueOnce(currentMessages),
		};

		const resolveFallbackText =
			await __test__.createDiscordEmptyRuntimeReplyResolver({
				client: client as never,
				sessionId: "session-1",
			});

		await expect(resolveFallbackText?.()).resolves.toBeUndefined();
		expect(client.readMessages).toHaveBeenCalledTimes(2);
	});

	it("resolves Discord participants from normalized gateway message authors", () => {
		expect(
			__test__.resolveDiscordParticipant(
				{
					content: "<@1509620637721821224> Heyo",
					author: {
						id: "bot-message-author-should-not-win",
						username: "beebot",
					},
				},
				{
					userId: "850213762576810065",
					userName: "alice",
					fullName: "Alice Example",
				},
			),
		).toEqual({
			key: "discord:user:850213762576810065",
			label: "Alice Example",
		});
	});

	it("resolves Discord interaction users even when raw.data is command data", () => {
		expect(
			__test__.resolveDiscordParticipant({
				id: "interaction-1",
				data: { name: "ask" },
				member: {
					user: {
						id: "488220547356950529",
						username: "bob",
						global_name: "Bob Example",
					},
				},
			}),
		).toEqual({
			key: "discord:user:488220547356950529",
			label: "Bob Example",
		});
	});

	it("switches Discord thread state to the incoming participant without reusing the previous participant session", async () => {
		const dir = await mkdtemp(join(tmpdir(), "discord-participants-"));
		const bindingsPath = join(dir, "threads.json");
		const thread = createThread({
			sessionId: "session-alice",
			participantKey: "discord:user:alice",
			participantLabel: "Alice",
		});
		writeBindings<TestDiscordState>(bindingsPath, {
			"discord:user:alice": {
				channelId: thread.channelId,
				isDM: thread.isDM,
				participantKey: "discord:user:alice",
				participantLabel: "Alice",
				serializedThread: JSON.stringify(thread.toJSON()),
				sessionId: "session-alice",
				state: {
					sessionId: "session-alice",
					participantKey: "discord:user:alice",
					participantLabel: "Alice",
				},
				updatedAt: "2026-05-26T00:00:00.000Z",
			},
		});

		await __test__.persistDiscordThreadContext({
			thread,
			bindingsPath,
			baseStartRequest: {
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp/work",
				workspaceRoot: "/tmp/work",
				systemPrompt: "system",
				provider: "cline",
				model: "test-model",
				mode: "act",
			},
			message: {
				raw: {
					author: {
						id: "bob",
						username: "bob",
						global_name: "Bob",
					},
				},
			},
			errorLabel: "Discord",
		});

		const bob =
			readBindings<TestDiscordState>(bindingsPath)["discord:user:bob"];
		expect(bob?.state?.participantKey).toBe("discord:user:bob");
		expect(bob?.state?.participantLabel).toBe("Bob");
		expect(bob?.state?.sessionId).toBeUndefined();
		expect(
			readBindings<TestDiscordState>(bindingsPath)["discord:user:alice"]?.state
				?.sessionId,
		).toBe("session-alice");
	});

	it("adds Discord author context to runtime turns", () => {
		expect(
			__test__.formatDiscordRuntimeText(
				"Heyo",
				{
					key: "discord:user:850213762576810065",
					label: "Alice Example",
				},
				{ ownerUserId: "850213762576810065" },
			),
		).toContain("authorId: 850213762576810065");
		expect(
			__test__.formatDiscordRuntimeText(
				"Heyo",
				{
					key: "discord:user:850213762576810065",
					label: "Alice Example",
				},
				{ ownerUserId: "850213762576810065" },
			),
		).toContain("isOwner: true");
	});

	it("resolves outbound Discord mention names to user mention ids", async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain(
				"/guilds/guild-123/members/search?query=cline-test-bot&limit=10",
			);
			return new Response(
				JSON.stringify([
					{
						nick: "cline-test-bot",
						user: {
							id: "1509620637721821224",
							username: "clinetestbot",
							bot: true,
						},
					},
				]),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			__test__.resolveDiscordOutboundMentions({
				botToken: "token",
				threadId: "discord:guild-123:channel-123:thread-123",
				text: "@cline-test-bot how is your day?",
			}),
		).resolves.toBe("<@1509620637721821224> how is your day?");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("repairs adapter-split hyphenated Discord mention names before resolving", async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain("query=cline-test-bot");
			return new Response(
				JSON.stringify([
					{
						nick: "cline-test-bot",
						user: {
							id: "1509620637721821224",
							username: "clinetestbot",
							bot: true,
						},
					},
				]),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			__test__.resolveDiscordOutboundMentions({
				botToken: "token",
				threadId: "discord:guild-123:channel-123:thread-123",
				text: "<@cline>-test-bot how is your day?",
			}),
		).resolves.toBe("<@1509620637721821224> how is your day?");
	});

	it("normalizes forwarded bot-role mentions as Discord mentions", async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain("/guilds/guild-role-test/members/app-123");
			return new Response(JSON.stringify({ roles: ["role-123"] }), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const request = new Request("https://example.test/api/webhooks/discord", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "GATEWAY_MESSAGE_CREATE",
				data: {
					id: "message-1",
					guild_id: "guild-role-test",
					channel_id: "channel-1",
					content: "<@&role-123> hello",
					mention_roles: ["role-123"],
					mentions: [],
					author: {
						id: "user-1",
						username: "alice",
						bot: false,
					},
				},
			}),
		});

		const normalized = await __test__.normalizeDiscordForwardedGatewayRequest({
			request,
			botToken: "token",
			applicationId: "app-123",
		});
		const event = (await normalized.json()) as {
			data: { is_mention?: boolean };
		};

		expect(event.data.is_mention).toBe(true);
	});

	it("restores persisted thread subscriptions once on startup", async () => {
		const dir = await mkdtemp(join(tmpdir(), "discord-bindings-"));
		const bindingsPath = join(dir, "threads.json");
		const subscribe = vi.fn(async () => undefined);
		const threads = new Map([
			[
				"thread-1",
				{
					id: "thread-1",
					subscribe,
				},
			],
		]);
		const bot = {
			reviver: () => (_key: string, value: unknown) => {
				if (
					value &&
					typeof value === "object" &&
					(value as { _type?: string })._type === "chat:Thread"
				) {
					return threads.get((value as { id: string }).id) ?? value;
				}
				return value;
			},
		};
		const logger = {
			core: { log: vi.fn() },
		} as unknown as Parameters<
			typeof __test__.restoreDiscordThreadSubscriptions
		>[0]["logger"];

		writeFileSync(
			bindingsPath,
			JSON.stringify({
				"discord:user:1": {
					channelId: "discord:g:c",
					isDM: false,
					participantKey: "discord:user:1",
					serializedThread: JSON.stringify({
						_type: "chat:Thread",
						id: "thread-1",
					}),
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				duplicate: {
					channelId: "discord:g:c",
					isDM: false,
					serializedThread: JSON.stringify({
						_type: "chat:Thread",
						id: "thread-1",
					}),
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			}),
		);

		const restored = await __test__.restoreDiscordThreadSubscriptions({
			bot,
			bindingsPath,
			logger,
		});

		expect(restored).toBe(1);
		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(logger.core.log).not.toHaveBeenCalled();
	});
});
