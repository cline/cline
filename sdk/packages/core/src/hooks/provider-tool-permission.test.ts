import type { AgentBeforeToolContext, AgentHooks } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createProviderToolPermission } from "./provider-tool-permission";

const REQUEST = {
	toolName: "Bash",
	toolCallId: "cli_bash_1",
	input: { command: "ls" },
};

describe("createProviderToolPermission", () => {
	it("returns undefined when no layer has a beforeTool hook", () => {
		expect(
			createProviderToolPermission({
				hooks: [undefined, { afterRun: async () => {} }],
				sessionId: "s1",
			}),
		).toBeUndefined();
	});

	it("allows when hooks return no control", async () => {
		const beforeTool = vi.fn(async (_ctx: AgentBeforeToolContext) => undefined);
		const gate = createProviderToolPermission({
			hooks: [{ beforeTool }],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({ behavior: "allow" });
		const ctx = beforeTool.mock.calls[0][0];
		expect(ctx.toolCall).toMatchObject({
			toolCallId: "cli_bash_1",
			toolName: "Bash",
			execution: "provider",
		});
		expect(ctx.input).toEqual({ command: "ls" });
		expect(ctx.snapshot).toMatchObject({
			agentId: "s1",
			conversationId: "s1",
		});
	});

	it("maps stop to an interrupting deny with the hook's reason", async () => {
		const gate = createProviderToolPermission({
			hooks: [{ beforeTool: async () => ({ stop: true, reason: "nope" }) }],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "deny",
			message: "nope",
			interrupt: true,
		});
	});

	it("maps skip to a non-interrupting deny with a default message", async () => {
		const gate = createProviderToolPermission({
			hooks: [{ beforeTool: async () => ({ skip: true }) }],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "deny",
			message: 'Tool "Bash" was blocked by a Cline hook',
			interrupt: false,
		});
	});

	it("maps an input override to allow with updatedInput", async () => {
		const gate = createProviderToolPermission({
			hooks: [{ beforeTool: async () => ({ input: { command: "ls -la" } }) }],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "allow",
			updatedInput: { command: "ls -la" },
		});
	});

	it("consults every layer and lets any of them deny", async () => {
		const first: AgentHooks = { beforeTool: async () => undefined };
		const second: AgentHooks = {
			beforeTool: async () => ({ skip: true, reason: "layer two says no" }),
		};
		const gate = createProviderToolPermission({
			hooks: [first, second],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "deny",
			message: "layer two says no",
			interrupt: false,
		});
	});

	it("stops at the first denial: later layers are never consulted and cannot erase it", async () => {
		const later = vi.fn(async () => {
			throw new Error("boom");
		});
		const gate = createProviderToolPermission({
			hooks: [
				{ beforeTool: async () => ({ skip: true, reason: "denied first" }) },
				{ beforeTool: later },
			],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "deny",
			message: "denied first",
			interrupt: false,
		});
		expect(later).not.toHaveBeenCalled();
	});

	it("lets later layers deny after an earlier layer throws", async () => {
		const gate = createProviderToolPermission({
			hooks: [
				{
					beforeTool: async () => {
						throw new Error("boom");
					},
				},
				{ beforeTool: async () => ({ stop: true, reason: "still denied" }) },
			],
			sessionId: "s1",
			logger: { log: vi.fn(), debug: vi.fn() },
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "deny",
			message: "still denied",
			interrupt: true,
		});
	});

	it("threads input overrides through subsequent layers", async () => {
		const seenBySecond = vi.fn(async (ctx: AgentBeforeToolContext) => {
			expect(ctx.input).toEqual({ command: "ls -la" });
			return undefined;
		});
		const gate = createProviderToolPermission({
			hooks: [
				{ beforeTool: async () => ({ input: { command: "ls -la" } }) },
				{ beforeTool: seenBySecond },
			],
			sessionId: "s1",
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "allow",
			updatedInput: { command: "ls -la" },
		});
		expect(seenBySecond).toHaveBeenCalled();
	});

	it("keeps an earlier valid rewrite when a later layer returns a non-object input", async () => {
		const log = vi.fn();
		const gate = createProviderToolPermission({
			hooks: [
				{ beforeTool: async () => ({ input: { command: "ls -la" } }) },
				{ beforeTool: async () => ({ input: "not-an-object" }) },
			],
			sessionId: "s1",
			logger: { log, debug: vi.fn() },
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({
			behavior: "allow",
			updatedInput: { command: "ls -la" },
		});
		expect(log).toHaveBeenCalled();
	});

	it("ignores a non-object rewrite when no valid rewrite preceded it", async () => {
		const gate = createProviderToolPermission({
			hooks: [{ beforeTool: async () => ({ input: 42 }) }],
			sessionId: "s1",
			logger: { log: vi.fn(), debug: vi.fn() },
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({ behavior: "allow" });
	});

	it("fails open when a hook throws", async () => {
		const log = vi.fn();
		const gate = createProviderToolPermission({
			hooks: [
				{
					beforeTool: async () => {
						throw new Error("boom");
					},
				},
			],
			sessionId: "s1",
			logger: { log, debug: vi.fn() },
		});
		await expect(gate?.(REQUEST)).resolves.toEqual({ behavior: "allow" });
		expect(log).toHaveBeenCalled();
	});
});
