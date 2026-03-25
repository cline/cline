import { describe, expect, it } from "vitest";
import { __test__ } from "./slack";

describe("slack binding lookup", () => {
	it("falls back to channel identity when a restarted connector gets a new thread id", () => {
		const result = __test__.findBindingForThread(
			{
				legacy_thread_id: {
					channelId: "slack:C123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1", cwd: "/tmp/work", teamId: "T123" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "new_thread_id",
				channelId: "slack:C123",
				isDM: false,
			},
		);

		expect(result).toEqual({
			key: "legacy_thread_id",
			binding: {
				channelId: "slack:C123",
				isDM: false,
				serializedThread: "{}",
				sessionId: "sess-1",
				state: { sessionId: "sess-1", cwd: "/tmp/work", teamId: "T123" },
				updatedAt: "2026-03-17T00:00:00.000Z",
			},
		});
	});

	it("prefers an exact thread id match over a channel fallback", () => {
		const result = __test__.findBindingForThread(
			{
				current_thread_id: {
					channelId: "slack:C123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-2",
					state: { sessionId: "sess-2", teamId: "T123" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
				legacy_thread_id: {
					channelId: "slack:C123",
					isDM: false,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1", teamId: "T123" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "current_thread_id",
				channelId: "slack:C123",
				isDM: false,
			},
		);

		expect(result?.key).toBe("current_thread_id");
		expect(result?.binding.sessionId).toBe("sess-2");
	});

	it("reuses a binding by participant key across different threads", () => {
		const result = __test__.findBindingForThread(
			{
				"slack:user:U123": {
					channelId: "slack:C123",
					isDM: false,
					participantKey: "slack:user:U123",
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						teamId: "T123",
						participantKey: "slack:user:U123",
						participantLabel: "alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "other_thread_id",
				channelId: "slack:C999",
				isDM: false,
				participantKey: "slack:user:U123",
			},
		);

		expect(result?.key).toBe("slack:user:U123");
		expect(result?.binding.sessionId).toBe("sess-1");
	});
});
