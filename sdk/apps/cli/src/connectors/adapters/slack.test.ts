import { describe, expect, it } from "vitest";
import { __test__ } from "./slack";

describe("slack binding lookup", () => {
	const participantKey = __test__.buildSlackParticipantKey("T123", "U123");

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
				[participantKey]: {
					channelId: "slack:C123",
					isDM: false,
					participantKey,
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						teamId: "T123",
						participantKey,
						participantLabel: "alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "other_thread_id",
				channelId: "slack:C999",
				isDM: false,
				participantKey,
			},
		);

		expect(result?.key).toBe(participantKey);
		expect(result?.binding.sessionId).toBe("sess-1");
	});

	it("builds Slack participant keys with a team scope", () => {
		expect(__test__.buildSlackParticipantKey("T123", "U123")).toBe(
			"slack:team:T123:user:U123",
		);
	});

	it("requires team context before resolving a Slack participant key", () => {
		expect(
			__test__.resolveSlackParticipant(
				{ user: "U123", username: "alice" },
				undefined,
			),
		).toBeUndefined();
		expect(
			__test__.resolveSlackParticipant(
				{ team_id: "T123", user: "U123", username: "alice" },
				"T123",
			),
		).toEqual({
			key: "slack:team:T123:user:U123",
			label: "alice",
		});
	});

	it("normalizes direct-message channels even when Slack omits im channel_type", () => {
		expect(
			__test__.normalizeSlackMessageEventChannelType({
				channel: "D123",
				channel_type: "app_home",
				ts: "123.456",
			}),
		).toEqual({
			channel: "D123",
			channel_type: "im",
			ts: "123.456",
		});
		expect(
			__test__.normalizeSlackMessageEventChannelType({
				channel: "D123",
				ts: "123.456",
			}),
		).toEqual({
			channel: "D123",
			channel_type: "im",
			ts: "123.456",
		});
	});

	it("leaves non-DM Slack message events unchanged", () => {
		const channelEvent = {
			channel: "C123",
			channel_type: "channel",
			ts: "123.456",
		};
		expect(__test__.normalizeSlackMessageEventChannelType(channelEvent)).toBe(
			channelEvent,
		);
	});

	it("routes Slack posts through the installation bot token for a team", async () => {
		const calls: string[] = [];
		const result = await __test__.withSlackTeamBotToken({
			slack: {
				getInstallation: async (teamId: string) => {
					calls.push(`get:${teamId}`);
					return { botToken: "xoxb-team-token" };
				},
				withBotToken: <T>(token: string, work: () => T): T => {
					calls.push(`token:${token}`);
					return work();
				},
			},
			teamId: "T123",
			work: async () => {
				calls.push("work");
				return "ok";
			},
		});

		expect(result).toBe("ok");
		expect(calls).toEqual(["get:T123", "token:xoxb-team-token", "work"]);
	});

	it("detects Slack invalid_thread_ts errors", () => {
		expect(
			__test__.isSlackInvalidThreadTsError(
				new Error("An API error occurred: invalid_thread_ts"),
			),
		).toBe(true);
		expect(
			__test__.isSlackInvalidThreadTsError(
				new Error("An API error occurred: channel_not_found"),
			),
		).toBe(false);
	});
});
