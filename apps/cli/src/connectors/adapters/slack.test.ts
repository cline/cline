import type { ConnectSlackOptions } from "@cline/shared";
import { type Message, ThreadImpl } from "chat";
import { describe, expect, it } from "vitest";
import { __test__, slackConnector } from "./slack";

const parseSlackArgs = (rawArgs: string[]): ConnectSlackOptions =>
	(
		slackConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectSlackOptions;
		}
	).parseArgs(rawArgs);

describe("slack binding lookup", () => {
	const participantKey = __test__.buildSlackParticipantKey("T123", "U123");

	it("infers Slack webhook mode from a base URL", () => {
		expect(__test__.inferSlackConnectionMode("https://example.test")).toBe(
			"webhook",
		);
		expect(__test__.inferSlackConnectionMode("  ")).toBe("socket");
		expect(__test__.inferSlackConnectionMode(undefined)).toBe("socket");
	});

	it("uses webhook mode when Slack args include a base URL", () => {
		const options = parseSlackArgs([
			"--bot-token",
			"xoxb-token",
			"--signing-secret",
			"secret",
			"--app-token",
			"xapp-ignored",
			"--base-url",
			"https://example.test",
		]);

		expect(options.connectionMode).toBe("webhook");
		expect(options.baseUrl).toBe("https://example.test");
		expect(options.signingSecret).toBe("secret");
		expect(options.appToken).toBeUndefined();
	});

	it("uses socket mode when Slack args omit a base URL", () => {
		const previousBaseUrl = process.env.BASE_URL;
		delete process.env.BASE_URL;
		let options: ConnectSlackOptions;
		try {
			options = parseSlackArgs([
				"--bot-token",
				"xoxb-token",
				"--app-token",
				"xapp-token",
			]);
		} finally {
			if (previousBaseUrl === undefined) {
				delete process.env.BASE_URL;
			} else {
				process.env.BASE_URL = previousBaseUrl;
			}
		}

		expect(options.connectionMode).toBe("socket");
		expect(options.baseUrl).toBeUndefined();
		expect(options.appToken).toBe("xapp-token");
	});

	it("falls back to DM channel identity when a restarted connector gets a new thread id", () => {
		const result = __test__.findBindingForThread(
			{
				legacy_thread_id: {
					channelId: "slack:C123",
					isDM: true,
					serializedThread: "{}",
					sessionId: "sess-1",
					state: { sessionId: "sess-1", cwd: "/tmp/work", teamId: "T123" },
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "new_thread_id",
				channelId: "slack:C123",
				isDM: true,
			},
		);

		expect(result).toEqual({
			key: "legacy_thread_id",
			binding: {
				channelId: "slack:C123",
				isDM: true,
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

	it("does not reuse a binding by participant key across different threads", () => {
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

		expect(result).toBeUndefined();
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

	it("normalizes top-level channel mentions to the original Slack post thread", () => {
		const original = new ThreadImpl({
			adapterName: "slack",
			channelId: "slack:C123",
			id: "slack:C123:",
			isDM: false,
		});
		const message = {
			raw: {
				channel: "C123",
				text: "<@U999> help",
				ts: "1710000000.123456",
				type: "app_mention",
				user: "U123",
			},
		} as Message;

		const normalized = __test__.resolveSlackChannelMentionThread(
			original,
			message,
		);

		expect(normalized.id).toBe("slack:C123:1710000000.123456");
		expect(normalized.channelId).toBe("slack:C123");
		expect(normalized.isDM).toBe(false);
	});

	it("uses Slack thread_ts instead of reply ts for in-thread mentions", () => {
		const original = new ThreadImpl({
			adapterName: "slack",
			channelId: "slack:C123",
			id: "slack:C123:1710000001.654321",
			isDM: false,
		});
		const message = {
			raw: {
				channel: "C123",
				text: "<@U999> follow up",
				thread_ts: "1710000000.123456",
				ts: "1710000001.654321",
				type: "app_mention",
				user: "U123",
			},
		} as Message;

		const normalized = __test__.resolveSlackChannelMentionThread(
			original,
			message,
		);

		expect(normalized.id).toBe("slack:C123:1710000000.123456");
		expect(normalized.channelId).toBe("slack:C123");
		expect(normalized.isDM).toBe(false);
	});

	it("keeps Slack mention threads that already target the original post", () => {
		const original = new ThreadImpl({
			adapterName: "slack",
			channelId: "slack:C123",
			id: "slack:C123:1710000000.123456",
			isDM: false,
		});
		const message = {
			raw: {
				channel: "C123",
				text: "<@U999> help",
				ts: "1710000000.123456",
				type: "app_mention",
				user: "U123",
			},
		} as Message;

		expect(__test__.resolveSlackChannelMentionThread(original, message)).toBe(
			original,
		);
	});

	it("does not rewrite Slack DM mention threads", () => {
		const original = new ThreadImpl({
			adapterName: "slack",
			channelId: "slack:D123",
			id: "slack:D123:",
			isDM: true,
		});
		const message = {
			raw: {
				channel: "D123",
				text: "help",
				ts: "1710000000.123456",
				type: "message",
				user: "U123",
			},
		} as Message;

		expect(__test__.resolveSlackChannelMentionThread(original, message)).toBe(
			original,
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

	it("strips the leading bot mention from Slack message text", () => {
		expect(
			__test__.stripSlackBotMention("@U0B8E8H3U1F hi", "U0B8E8H3U1F"),
		).toBe("hi");
		expect(
			__test__.stripSlackBotMention("<@U0B8E8H3U1F> hi", "U0B8E8H3U1F"),
		).toBe("hi");
		expect(
			__test__.stripSlackBotMention("<@U0B8E8H3U1F|cline> hi", "U0B8E8H3U1F"),
		).toBe("hi");
		expect(
			__test__.stripSlackBotMention("  @U0B8E8H3U1F: hi", "U0B8E8H3U1F"),
		).toBe("hi");
		expect(
			__test__.stripSlackBotMention(
				"@U0B8E8H3U1F @U0B8E8H3U1F hi",
				"U0B8E8H3U1F",
			),
		).toBe("hi");
	});

	it("keeps Slack text that does not start with the bot mention", () => {
		expect(
			__test__.stripSlackBotMention("hi @U0B8E8H3U1F", "U0B8E8H3U1F"),
		).toBe("hi @U0B8E8H3U1F");
		expect(__test__.stripSlackBotMention("@U999999 hi", "U0B8E8H3U1F")).toBe(
			"@U999999 hi",
		);
		expect(__test__.stripSlackBotMention("@cline hi", "U0B8E8H3U1F")).toBe(
			"@cline hi",
		);
		expect(__test__.stripSlackBotMention("@U0B8E8H3U1F hi", undefined)).toBe(
			"@U0B8E8H3U1F hi",
		);
	});

	it("keeps mentions of other Slack users whose id starts with the bot id", () => {
		expect(__test__.stripSlackBotMention("@U1234 help", "U123")).toBe(
			"@U1234 help",
		);
		expect(__test__.stripSlackBotMention("@U123 hi", "U123")).toBe("hi");
		expect(__test__.stripSlackBotMention("<@U1234> help", "U123")).toBe(
			"<@U1234> help",
		);
		expect(__test__.stripSlackBotMention("<@U1234|other> help", "U123")).toBe(
			"<@U1234|other> help",
		);
		expect(
			__test__.stripSlackBotMention("@U0B8E8H3U1FX hi", "U0B8E8H3U1F"),
		).toBe("@U0B8E8H3U1FX hi");
		expect(
			__test__.stripSlackBotMention(
				"@U0B8E8H3U1F @U0B8E8H3U1FX hi",
				"U0B8E8H3U1F",
			),
		).toBe("@U0B8E8H3U1FX hi");
	});

	it("keeps a bare Slack bot mention so the turn is not dropped", () => {
		expect(__test__.stripSlackBotMention("@U0B8E8H3U1F", "U0B8E8H3U1F")).toBe(
			"@U0B8E8H3U1F",
		);
		expect(
			__test__.stripSlackBotMention("<@U0B8E8H3U1F>  ", "U0B8E8H3U1F"),
		).toBe("<@U0B8E8H3U1F>  ");
	});

	it("resolves the Slack bot user id from the adapter or event authorizations", () => {
		expect(__test__.resolveSlackBotUserId({ botUserId: "U0B8E8H3U1F" })).toBe(
			"U0B8E8H3U1F",
		);
		expect(
			__test__.resolveSlackBotUserId(
				{ botUserId: undefined },
				{ authorizations: [{ user_id: "U0B8E8H3U1F" }] },
			),
		).toBe("U0B8E8H3U1F");
		expect(
			__test__.resolveSlackBotUserId({ botUserId: undefined }, { text: "hi" }),
		).toBeUndefined();
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

describe("slack legacy connector state", () => {
	it("stops a live connector recorded by a pre-claim state file (no claimId)", async () => {
		const { spawn } = await import("node:child_process");
		const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import(
			"node:fs"
		);
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");

		const previousDataDir = process.env.CLINE_DATA_DIR;
		const dataDir = mkdtempSync(join(tmpdir(), "slack-legacy-state-"));
		process.env.CLINE_DATA_DIR = dataDir;
		const child = spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ stdio: "ignore" },
		);
		try {
			const stateDir = join(dataDir, "connectors", "slack");
			mkdirSync(stateDir, { recursive: true });
			writeFileSync(
				join(stateDir, "mybot.json"),
				JSON.stringify({
					userName: "mybot",
					connectionMode: "socket",
					pid: child.pid,
					// Unreachable on purpose: session cleanup falls back to
					// local storage inside the isolated data dir.
					rpcAddress: "ws://127.0.0.1:1/hub",
					startedAt: new Date(0).toISOString(),
				}),
				"utf8",
			);

			const io = { writeln: () => {}, writeErr: () => {} };
			const result = await slackConnector.stopInstance?.("mybot", io);

			expect(result?.stoppedProcesses).toBe(1);
		} finally {
			child.kill("SIGKILL");
			if (previousDataDir === undefined) {
				delete process.env.CLINE_DATA_DIR;
			} else {
				process.env.CLINE_DATA_DIR = previousDataDir;
			}
			rmSync(dataDir, { recursive: true, force: true });
		}
	});
});
