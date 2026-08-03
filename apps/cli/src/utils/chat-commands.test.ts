import { describe, expect, it, vi } from "vitest";
import {
	createChatCommandHost,
	isCommandAddressedToBot,
	maybeHandleChatCommand,
	normalizeCommandName,
} from "./chat-commands";

describe("chat commands", () => {
	it("shows connector help for /help and /start", async () => {
		for (const { command, botUserName } of [
			{ command: "/help" },
			{ command: "/start" },
			{ command: "/help@clinebot", botUserName: "clinebot" },
			{ command: "/start@cline_bot", botUserName: "@cline_bot" },
		]) {
			const reply = vi.fn(async () => undefined);

			const handled = await maybeHandleChatCommand(command, {
				enabled: true,
				botUserName,
				getState: async () => ({
					enableTools: true,
					autoApproveTools: false,
					cwd: "/tmp",
					workspaceRoot: "/tmp",
				}),
				setState: async () => undefined,
				reply,
			});

			expect(handled).toBe(true);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining("Cline connector commands:"),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining("Current state: tools=on, yolo=off"),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining(
					"/schedule create/list/trigger/delete - manage scheduled workflows",
				),
			);
			expect(reply).toHaveBeenCalledWith(
				expect.stringContaining(
					"When tools are on, I can inspect files, edit code, run commands/tests, and help prepare PRs.",
				),
			);
		}
	});

	it("does not handle bot-suffixed commands addressed to another bot", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help@otherbot", {
			enabled: true,
			botUserName: "clinebot",
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("requires a bot suffix when requested", async () => {
		const reply = vi.fn(async () => undefined);
		const context = {
			enabled: true,
			botUserName: "clinebot",
			requireBotMention: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		};

		expect(await maybeHandleChatCommand("/help", context)).toBe(false);
		expect(reply).not.toHaveBeenCalled();

		expect(await maybeHandleChatCommand("/help@clinebot", context)).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("Cline connector commands:"),
		);
	});

	it("detects commands addressed to the configured bot", () => {
		expect(isCommandAddressedToBot("/new@clinebot", "clinebot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline_bot", "@cline_bot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline.bot", "cline.bot")).toBe(true);
		expect(isCommandAddressedToBot("/new@cline-bot", "cline-bot")).toBe(true);
		expect(isCommandAddressedToBot("/new", "clinebot")).toBe(false);
		expect(isCommandAddressedToBot("/new@otherbot", "clinebot")).toBe(false);
		expect(isCommandAddressedToBot("/new@clinebot", undefined)).toBe(false);
	});

	it("normalizes commands addressed to dotted and hyphenated bot names", () => {
		expect(normalizeCommandName("/new@cline.bot", "cline.bot")).toBe("/new");
		expect(normalizeCommandName("/new@cline-bot", "cline-bot")).toBe("/new");
	});

	it("leaves bot-suffixed commands unmatched without a known bot username", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help@clinebot", {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("explains when tool controls are locked by startup", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/help", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
				toolsLocked: true,
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining(
				"Tool controls are locked because this connector was started with --no-tools.",
			),
		);
	});

	it("treats /new as a reset alias", async () => {
		const reset = vi.fn(async () => undefined);
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/new", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			reset,
		});

		expect(handled).toBe(true);
		expect(reset).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith("Started a fresh session.");
	});

	it("supports registering reusable commands on a host", async () => {
		const reply = vi.fn(async () => undefined);
		const host = createChatCommandHost().register("command", {
			names: ["/echo"],
			run: async ({ args }, context) => {
				await context.reply(args.join(" "));
			},
		});

		const handled = await host.handle("/echo hello world", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("hello world");
	});

	it("shows usage for /team with no arguments", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/team", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			"Usage: /team <task description>\nStarts a team of agents for the given task.",
		);
	});

	it("replies with unsupported message for /team with arguments in default host", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/team build a web app", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith(
			"The /team command must be entered directly as a prompt, not via a chat command.",
		);
	});

	it("runs /fork and replies with forked session ids", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => ({
			forkedFromSessionId: "sess_original",
			newSessionId: "sess_fork",
		}));

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith(
			"Forked session sess_original into new session sess_fork. This is now the active session. Use /history to switch sessions.",
		);
	});

	it("replies with failure message when fork returns undefined", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith(
			"Fork failed: could not read messages from the current session.",
		);
	});

	it("surfaces thrown error message when fork throws", async () => {
		const reply = vi.fn(async () => undefined);
		const fork = vi.fn(async () => {
			throw new Error("Cannot fork an empty session.");
		});

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			fork,
		});

		expect(handled).toBe(true);
		expect(fork).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith("Cannot fork an empty session.");
	});

	it("ignores /fork when fork callback is not provided", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/fork", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			// No fork callback, so the command should not be available.
		});

		// isAvailable returns false when fork is not defined, so the command
		// is not matched and the handler returns false.
		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("ignores /goal when the goal context is not provided", async () => {
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/goal fix tests", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(false);
		expect(reply).not.toHaveBeenCalled();
	});

	it("falls through to a later same-name command when the first is unavailable", async () => {
		const reply = vi.fn(async () => undefined);
		const pluginRun = vi.fn(async (_parsed, context) => {
			await context.reply("plugin goal");
		});
		// Mirrors a plugin registering /goal on a clone of the default host:
		// the built-in /goal is unavailable without a goal context, so the
		// plugin definition must still get a chance to handle the command.
		const host = createChatCommandHost().register("command", {
			names: ["/goal"],
			isAvailable: () => false,
			run: async () => {
				throw new Error("unavailable definition must not run");
			},
		});
		host.register("command", { names: ["/goal"], run: pluginRun });

		const handled = await host.handle("/goal fix tests", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(pluginRun).toHaveBeenCalledTimes(1);
		expect(reply).toHaveBeenCalledWith("plugin goal");
	});

	it("sets a goal via /goal and submits the returned prompt", async () => {
		const reply = vi.fn(async () => undefined);
		const submitPrompt = vi.fn(async () => undefined);
		const set = vi.fn(async (goal: string) => ({
			reply: `Goal set: ${goal}`,
			submitPrompt: `wrapped:${goal}`,
		}));

		const handled = await maybeHandleChatCommand("/goal fix the tests", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			submitPrompt,
			goal: {
				set,
				status: () => "status",
				clear: () => "cleared",
			},
		});

		expect(handled).toBe(true);
		expect(set).toHaveBeenCalledWith("fix the tests");
		expect(reply).toHaveBeenCalledWith("Goal set: fix the tests");
		expect(submitPrompt).toHaveBeenCalledWith("wrapped:fix the tests");
	});

	it("shows goal status for /goal and /goal status", async () => {
		for (const command of ["/goal", "/goal status"]) {
			const reply = vi.fn(async () => undefined);
			const status = vi.fn(() => "Active goal: fix tests");

			const handled = await maybeHandleChatCommand(command, {
				enabled: true,
				getState: async () => ({
					enableTools: false,
					autoApproveTools: false,
					cwd: "/tmp",
					workspaceRoot: "/tmp",
				}),
				setState: async () => undefined,
				reply,
				goal: {
					set: () => ({ reply: "" }),
					status,
					clear: () => "cleared",
				},
			});

			expect(handled).toBe(true);
			expect(status).toHaveBeenCalledTimes(1);
			expect(reply).toHaveBeenCalledWith("Active goal: fix tests");
		}
	});

	it("clears the goal for /goal off and aliases", async () => {
		for (const command of [
			"/goal off",
			"/goal clear",
			"/goal stop",
			"/goal disable",
		]) {
			const reply = vi.fn(async () => undefined);
			const clear = vi.fn(() => "Goal cleared.");

			const handled = await maybeHandleChatCommand(command, {
				enabled: true,
				getState: async () => ({
					enableTools: false,
					autoApproveTools: false,
					cwd: "/tmp",
					workspaceRoot: "/tmp",
				}),
				setState: async () => undefined,
				reply,
				goal: {
					set: () => ({ reply: "" }),
					status: () => "status",
					clear,
				},
			});

			expect(handled).toBe(true);
			expect(clear).toHaveBeenCalledTimes(1);
			expect(reply).toHaveBeenCalledWith("Goal cleared.");
		}
	});

	it("runs /abort without disconnecting", async () => {
		const abort = vi.fn(async () => undefined);
		const reply = vi.fn(async () => undefined);

		const handled = await maybeHandleChatCommand("/abort", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: "/tmp",
				workspaceRoot: "/tmp",
			}),
			setState: async () => undefined,
			reply,
			abort,
		});

		expect(handled).toBe(true);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(reply).not.toHaveBeenCalled();
	});
});
