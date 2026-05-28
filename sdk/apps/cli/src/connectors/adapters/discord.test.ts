import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectDiscordOptions } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { __test__, discordConnector } from "./discord";

const parseDiscordArgs = (rawArgs: string[]): ConnectDiscordOptions =>
	(
		discordConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectDiscordOptions;
		}
	).parseArgs(rawArgs);

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
		]);

		expect(options.applicationId).toBe("app-456");
		expect(options.botToken).toBe("other-token");
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
