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
