import { describe, expect, it, vi } from "vitest";
import {
	type ChatCommandState,
	chatCommandHost,
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
});
