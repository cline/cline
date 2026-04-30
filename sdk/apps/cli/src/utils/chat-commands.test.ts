import { describe, expect, it, vi } from "vitest";
import { createChatCommandHost, maybeHandleChatCommand } from "./chat-commands";

describe("chat commands", () => {
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
