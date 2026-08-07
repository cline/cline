import { describe, expect, it, vi } from "vitest";
import {
	type ChatCommandState,
	chatCommandHost,
	createChatCommandHost,
} from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
import {
	type InteractiveChatCommandRuntime,
	runInteractiveChatCommand,
} from "./chat-command-runner";

function makeConfig(): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		cwd: process.cwd(),
	};
}

function makeState(config: Config): ChatCommandState {
	return {
		enableTools: config.enableTools,
		autoApproveTools: config.defaultToolAutoApprove,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
}

function makeRuntime(): InteractiveChatCommandRuntime {
	return {
		forkCurrentSession: vi.fn(async () => undefined),
		getActiveSessionId: vi.fn(() => "session-1"),
		resetForNewSession: vi.fn(async () => {}),
		restartEmpty: vi.fn(async () => {}),
	};
}

describe("runInteractiveChatCommand", () => {
	it("handles missing team prompt body as command usage", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/team",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput:
					"Usage: /team <task description>\nStarts a team of agents for the given task.",
			},
		});
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
	});

	it("rewrites team prompts and enables teams before model submission", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/team inspect the TUI",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
		});

		expect(result.handled).toBe(false);
		if (!result.handled) {
			expect(result.input).toContain("spawn a team of agents");
			expect(result.input).toContain("inspect the TUI");
		}
		expect(config.enableAgentTeams).toBe(true);
		expect(config.teamName).toBeTruthy();
		expect(runtime.restartEmpty).toHaveBeenCalledOnce();
	});

	it("drops the goal when enabling teams restarts the session", async () => {
		// The teams-enable restart discards the current conversation, so a
		// goal set in it must not survive to verify against the team run.
		const config = makeConfig();
		const runtime = makeRuntime();
		const order: string[] = [];
		runtime.restartEmpty = vi.fn(async () => {
			order.push("restart");
		});
		const clear = vi.fn(() => {
			order.push("clear");
			return "Goal cleared.";
		});

		const result = await runInteractiveChatCommand({
			prompt: "/team inspect the TUI",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
			goal: {
				set: () => ({ reply: "" }),
				status: () => "status",
				clear,
			},
		});

		expect(result.handled).toBe(false);
		expect(order).toEqual(["restart", "clear"]);
	});

	it("drops the goal even when the teams-enable restart fails", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		runtime.restartEmpty = vi.fn(async () => {
			throw new Error("restart failed");
		});
		const clear = vi.fn(() => "Goal cleared.");

		await expect(
			runInteractiveChatCommand({
				prompt: "/team inspect the TUI",
				enabled: true,
				config,
				host: chatCommandHost,
				chatCommandState: makeState(config),
				autoApproveAllRef: { current: false },
				setInteractiveAutoApprove: () => {},
				sessionRuntime: runtime,
				stop: () => {},
				goal: {
					set: () => ({ reply: "" }),
					status: () => "status",
					clear,
				},
			}),
		).rejects.toThrow("restart failed");
		expect(clear).toHaveBeenCalledTimes(1);
	});

	it("resets slash new without eagerly restarting the runtime", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/new",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput: "Started a fresh session.",
			},
		});
		expect(runtime.resetForNewSession).toHaveBeenCalledOnce();
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
	});

	it("applies chat command state updates and returns command output", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const state = makeState(config);
		const autoApproveAllRef = { current: false };
		const setInteractiveAutoApprove = vi.fn((enabled: boolean) => {
			autoApproveAllRef.current = enabled;
		});

		const result = await runInteractiveChatCommand({
			prompt: "/yolo on",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: state,
			autoApproveAllRef,
			setInteractiveAutoApprove,
			sessionRuntime: runtime,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput: "yolo=on",
			},
		});
		expect(state.autoApproveTools).toBe(true);
		expect(setInteractiveAutoApprove).toHaveBeenCalledWith(true);
	});

	it("clears the active goal only after a chat command session reset succeeds", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const order: string[] = [];
		runtime.resetForNewSession = vi.fn(async () => {
			order.push("reset");
		});
		const clear = vi.fn(() => {
			order.push("clear");
			return "Goal cleared.";
		});

		const result = await runInteractiveChatCommand({
			prompt: "/new",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
			goal: {
				set: () => ({ reply: "" }),
				status: () => "status",
				clear,
			},
		});

		expect(result.handled).toBe(true);
		expect(order).toEqual(["reset", "clear"]);
	});

	it("drops the goal even when the session reset fails", async () => {
		// A failing reset can still have discarded the old conversation, so
		// the goal must not survive to attach to whichever session runs next.
		const config = makeConfig();
		const runtime = makeRuntime();
		runtime.resetForNewSession = vi.fn(async () => {
			throw new Error("reset failed");
		});
		const clear = vi.fn(() => "Goal cleared.");

		await expect(
			runInteractiveChatCommand({
				prompt: "/new",
				enabled: true,
				config,
				host: chatCommandHost,
				chatCommandState: makeState(config),
				autoApproveAllRef: { current: false },
				setInteractiveAutoApprove: () => {},
				sessionRuntime: runtime,
				stop: () => {},
				goal: {
					set: () => ({ reply: "" }),
					status: () => "status",
					clear,
				},
			}),
		).rejects.toThrow("reset failed");
		expect(clear).toHaveBeenCalledTimes(1);
	});

	it("returns plugin command submit prompts as model input", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const onCommandOutput = vi.fn();
		const host = createChatCommandHost().register("command", {
			names: ["/goal"],
			run: async ({ args }, context) => {
				await context.reply(`Goal guard set: ${args.join(" ")}`);
				await context.submitPrompt?.(args.join(" "));
			},
		});

		const result = await runInteractiveChatCommand({
			prompt: "/goal fix tests",
			enabled: true,
			config,
			host,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			stop: () => {},
			onCommandOutput,
		});

		expect(result).toEqual({
			handled: false,
			input: "fix tests",
			commandOutput: "Goal guard set: fix tests",
		});
		expect(onCommandOutput).toHaveBeenCalledWith("Goal guard set: fix tests");
	});
});
