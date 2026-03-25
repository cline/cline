import { describe, expect, it } from "vitest";
import { __test__ } from "./telegram";

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
