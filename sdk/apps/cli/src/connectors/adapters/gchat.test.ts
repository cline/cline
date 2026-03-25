import { describe, expect, it } from "vitest";
import { __test__ } from "./gchat";

describe("gchat binding lookup", () => {
	it("falls back to channel identity when a restarted connector gets a new thread id", () => {
		const result = __test__.findBindingForThread(
			{
				legacy_thread_id: {
					channelId: "space-123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1", cwd: "/tmp/work" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "new_thread_id",
				channelId: "space-123",
				isDM: false,
			},
		);

		expect(result).toEqual({
			key: "legacy_thread_id",
			binding: {
				channelId: "space-123",
				isDM: false,
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
					channelId: "space-123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-2",
					state: { sessionId: "sess-2" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
				legacy_thread_id: {
					channelId: "space-123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "current_thread_id",
				channelId: "space-123",
				isDM: false,
			},
		);

		expect(result?.key).toBe("current_thread_id");
		expect(result?.binding.sessionId).toBe("sess-2");
	});

	it("reuses a binding by participant key across different spaces", () => {
		const result = __test__.findBindingForThread(
			{
				"gchat:email:alice@example.com": {
					channelId: "space-123",
					isDM: false,
					participantKey: "gchat:email:alice@example.com",
					participantLabel: "alice@example.com",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						participantKey: "gchat:email:alice@example.com",
						participantLabel: "alice@example.com",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "other_thread_id",
				channelId: "space-999",
				isDM: false,
				participantKey: "gchat:email:alice@example.com",
			},
		);

		expect(result?.key).toBe("gchat:email:alice@example.com");
		expect(result?.binding.sessionId).toBe("sess-1");
	});
});
