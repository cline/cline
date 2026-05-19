import type { ConnectTelegramOptions } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { __test__, telegramConnector } from "./telegram";

const parseTelegramArgs = (rawArgs: string[]): ConnectTelegramOptions =>
	(
		telegramConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectTelegramOptions;
		}
	).parseArgs(rawArgs);

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

	it("reuses a binding by participant key across different chats", () => {
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

		expect(result?.key).toBe("telegram:user:alice");
		expect(result?.binding.sessionId).toBe("sess-1");
	});
});
