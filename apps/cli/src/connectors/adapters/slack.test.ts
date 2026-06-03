import { describe, expect, it, vi } from "vitest";
import { __test__ } from "./slack";

describe("slack binding lookup", () => {
	const participantKey = __test__.buildSlackParticipantKey("T123", "U123");

	it("accepts the documented --token alias for the bot token", () => {
		expect(
			__test__.parseSlackOptionsForTest([
				"--token",
				"xoxb-documented-token",
				"--signing-secret",
				"secret",
				"--base-url",
				"http://127.0.0.1:8787",
			]).botToken,
		).toBe("xoxb-documented-token");
	});

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

	it("does not reuse a thread-scoped binding by participant key across Slack channel threads", () => {
		const result = __test__.findBindingForThread(
			{
				"slack:C123:111.222": {
					channelId: "slack:C123",
					isDM: false,
					participantKey,
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						teamId: "T123",
						bindingScope: "thread",
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
				bindingScope: "thread",
			},
		);

		expect(result).toBeUndefined();
	});

	it("can still reuse participant-scoped bindings for Slack DMs", () => {
		const result = __test__.findBindingForThread(
			{
				[participantKey]: {
					channelId: "slack:D123",
					isDM: true,
					participantKey,
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						teamId: "T123",
						bindingScope: "participant",
						participantKey,
						participantLabel: "alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "slack:D123",
				channelId: "slack:D123",
				isDM: true,
				participantKey,
				bindingScope: "participant",
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

	it("strips a leading Slack mention before command handling", () => {
		expect(__test__.stripLeadingSlackMention("<@U123> /help")).toBe(
			"<@U123> /help",
		);
		expect(__test__.stripLeadingSlackMention("<@U123> /help", "U999")).toBe(
			"<@U123> /help",
		);
		expect(__test__.stripLeadingSlackMention("<@U123> /help", "U123")).toBe(
			"/help",
		);
		expect(__test__.stripLeadingSlackMention(" <@U123|Cline> /whereami")).toBe(
			"<@U123|Cline> /whereami",
		);
		expect(
			__test__.stripLeadingSlackMention(" <@U123|Cline> /whereami", "U123"),
		).toBe("/whereami");
		expect(__test__.stripLeadingSlackMention("hello <@U123> /help")).toBe(
			"hello <@U123> /help",
		);
	});

	it("uses raw Slack mention markup for command handling when display text is normalized", () => {
		expect(
			__test__.resolveSlackTurnText({
				text: "@Cline CLI Test /help",
				raw: { text: "<@U123> /help" },
				botUserId: "U123",
			}),
		).toBe("/help");
		expect(
			__test__.resolveSlackTurnText({
				text: "@Other User /help",
				raw: { text: "<@U999> /help" },
				botUserId: "U123",
			}),
		).toBe("@Other User /help");
	});

	it("adds Slack author context to runtime text", () => {
		expect(
			__test__.formatSlackRuntimeText({
				text: "What's Ara's first question?",
				thread: {
					id: "slack:C123:111.222",
					channelId: "slack:C123",
					isDM: false,
				} as never,
				state: {
					teamId: "T123",
					bindingScope: "thread",
					participantKey: "slack:team:T123:user:U08LK8A7YTC",
					participantLabel: "Ara",
				},
				addressedToBot: false,
			}),
		).toBe(
			[
				"<slack_message_context>",
				"teamId: T123",
				"threadId: slack:C123:111.222",
				"channelId: slack:C123",
				"isDM: false",
				"authorId: U08LK8A7YTC",
				"authorMention: <@U08LK8A7YTC>",
				"authorLabel: Ara",
				"participantKey: slack:team:T123:user:U08LK8A7YTC",
				"isDirectMention: false",
				"</slack_message_context>",
				"",
				"What's Ara's first question?",
			].join("\n"),
		);
	});

	it("resolves outbound Slack display names to user mention ids", () => {
		expect(
			__test__.resolveSlackOutboundMentionText({
				text: "@Ara can you check this?",
				users: [
					{
						id: "U08LK8A7YTC",
						name: "ara",
						profile: { display_name: "Ara" },
					},
				],
			}),
		).toBe("<@U08LK8A7YTC> can you check this?");
	});

	it("resolves outbound multi-word Slack display names", () => {
		expect(
			__test__.resolveSlackOutboundMentionText({
				text: "@Cline CLI Test can you take a look?",
				users: [
					{
						id: "U0B4S0ZUVM2",
						name: "cline-cli-test",
						profile: { display_name: "Cline CLI Test" },
					},
				],
			}),
		).toBe("<@U0B4S0ZUVM2> can you take a look?");
	});

	it("leaves ambiguous outbound Slack names unresolved unless a preferred user matches", () => {
		const users = [
			{
				id: "U111",
				name: "alice-one",
				profile: { display_name: "Alice" },
			},
			{
				id: "U222",
				name: "alice-two",
				profile: { display_name: "Alice" },
			},
		];

		expect(
			__test__.resolveSlackOutboundMentionText({
				text: "@Alice please check this.",
				users,
			}),
		).toBe("@Alice please check this.");
		expect(
			__test__.resolveSlackOutboundMentionText({
				text: "@Alice please check this.",
				users,
				preferredUserIds: ["U222"],
			}),
		).toBe("<@U222> please check this.");
	});

	it("skips Slack user lookup when text has no resolvable outbound mention", async () => {
		const usersList = vi.fn(async () => ({ ok: true, members: [] }));

		await expect(
			__test__.resolveSlackOutboundMentions({
				slack: { webClient: { users: { list: usersList } } } as never,
				text: "Ping <@U123> or email test@example.com.",
			}),
		).resolves.toBe("Ping <@U123> or email test@example.com.");
		expect(usersList).not.toHaveBeenCalled();
	});

	it("posts final Slack replies through the thread after resolving mentions", async () => {
		const usersList = vi.fn(async () => ({
			ok: true,
			members: [
				{
					id: "U08LK8A7YTC",
					name: "ara",
					profile: { display_name: "Ara" },
				},
			],
		}));
		const fallbackPost = vi.fn(async () => undefined);

		await __test__.postSlackResolvedText({
			slack: {
				webClient: {
					users: { list: usersList },
				},
			} as never,
			thread: {
				id: "slack:C123:111.222",
				post: fallbackPost,
			} as never,
			text: "@Ara shipped the fix.",
		});

		expect(fallbackPost).toHaveBeenCalledWith(
			"<@U08LK8A7YTC> shipped the fix.",
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
