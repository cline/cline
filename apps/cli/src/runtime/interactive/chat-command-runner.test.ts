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

function makeRuntime(): InteractiveChatCommandRuntime & {
	changeWorkingDirectory: (next: ChatCommandState) => Promise<void>;
} {
	return {
		forkCurrentSession: vi.fn(async () => undefined),
		getActiveSessionId: vi.fn(() => "session-1"),
		resetForNewSession: vi.fn(async () => {}),
		restartEmpty: vi.fn(async () => {}),
		changeWorkingDirectory: vi.fn(async () => {}),
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
			changeWorkingDirectory: runtime.changeWorkingDirectory,
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
			changeWorkingDirectory: runtime.changeWorkingDirectory,
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
			changeWorkingDirectory: runtime.changeWorkingDirectory,
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
			changeWorkingDirectory: runtime.changeWorkingDirectory,
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

	it("changes the runtime working directory before reporting /cd success", async () => {
		const config = makeConfig();
		const state = makeState(config);
		const runtime = makeRuntime();
		const target = process.cwd();
		state.cwd = "/tmp";
		state.workspaceRoot = "/tmp";
		vi.mocked(runtime.changeWorkingDirectory).mockImplementation(
			async (next) => {
				Object.assign(state, next);
			},
		);

		const result = await runInteractiveChatCommand({
			prompt: `/cd ${target}`,
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: state,
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			changeWorkingDirectory: runtime.changeWorkingDirectory,
			stop: () => {},
		});

		expect(runtime.changeWorkingDirectory).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: target }),
		);
		expect(state.cwd).toBe(target);
		expect(result).toMatchObject({
			handled: true,
			turnResult: { commandOutput: expect.stringContaining(`cwd=${target}`) },
		});
	});

	it("does not run /cd when the submission is queued behind an active turn", async () => {
		const config = makeConfig();
		const state = makeState(config);
		const runtime = makeRuntime();
		const target = process.cwd();
		state.cwd = "/tmp";
		state.workspaceRoot = "/tmp";

		await expect(
			runInteractiveChatCommand({
				prompt: `/cd ${target}`,
				enabled: true,
				delivery: "queue",
				config,
				host: chatCommandHost,
				chatCommandState: state,
				autoApproveAllRef: { current: false },
				setInteractiveAutoApprove: () => {},
				sessionRuntime: runtime,
				changeWorkingDirectory: runtime.changeWorkingDirectory,
				stop: () => {},
			}),
		).rejects.toThrow(
			"Cannot change working directory while a turn is running. Wait for it to finish or abort it first.",
		);

		expect(runtime.changeWorkingDirectory).not.toHaveBeenCalled();
		expect(state).toMatchObject({ cwd: "/tmp", workspaceRoot: "/tmp" });
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
			changeWorkingDirectory: runtime.changeWorkingDirectory,
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
