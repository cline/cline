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
		withLocalMutation: async (mutate) => await mutate(),
		forkCurrentSession: vi.fn(async () => undefined),
		getActiveSessionId: vi.fn(() => "session-1"),
		resetForNewSession: vi.fn(async () => {}),
		restartEmpty: vi.fn(async () => {}),
		restartWithCurrentMessages: vi.fn(async () => {}),
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

	it.each([
		"/tools off",
		"/team inspect the TUI",
	])("rejects %s before changing source config or chat state", async (prompt) => {
		const config = makeConfig();
		const state = makeState(config);
		const before = { ...config };
		const stateBefore = { ...state };
		const runtime = makeRuntime();
		runtime.withLocalMutation = async () => {
			throw new Error("handoff locked");
		};
		const setInteractiveAutoApprove = vi.fn();
		await expect(
			runInteractiveChatCommand({
				prompt,
				enabled: true,
				config,
				host: chatCommandHost,
				chatCommandState: state,
				autoApproveAllRef: { current: false },
				setInteractiveAutoApprove,
				sessionRuntime: runtime,
				stop: () => {},
			}),
		).rejects.toThrow("handoff locked");
		expect(config).toEqual(before);
		expect(state).toEqual(stateBefore);
		expect(setInteractiveAutoApprove).not.toHaveBeenCalled();
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
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
		expect(runtime.restartWithCurrentMessages).toHaveBeenCalledOnce();
	});

	it("keeps chat state mutations reserved until the runtime refresh finishes", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		let reserved = false;
		let finishRestart!: () => void;
		const restart = new Promise<void>((resolve) => {
			finishRestart = resolve;
		});
		runtime.withLocalMutation = async (mutate) => {
			reserved = true;
			try {
				return await mutate();
			} finally {
				reserved = false;
			}
		};
		runtime.restartWithCurrentMessages = vi.fn(() => restart);
		const changing = runInteractiveChatCommand({
			prompt: "/tools off",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: vi.fn(),
			sessionRuntime: runtime,
			stop: () => {},
		});
		await vi.waitFor(() =>
			expect(runtime.restartWithCurrentMessages).toHaveBeenCalled(),
		);
		expect(reserved).toBe(true);
		finishRestart();
		await changing;
		expect(reserved).toBe(false);
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
