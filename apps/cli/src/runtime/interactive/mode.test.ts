import { resolveSystemPrompt } from "@cline/cline-hub/connectors";
import { createTool } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	ACT_MODE_CONTINUATION_PROMPT,
	type AppliedModeChange,
	applyInteractiveModeConfig,
	createInteractiveModeSwitchTool,
	createModeSwitchNoticeTracker,
	type PendingModeChange,
	sendTurnWithActModeContinuation,
} from "./mode";

vi.mock("@cline/cline-hub/connectors", () => ({
	resolveSystemPrompt: vi.fn(async (input: { mode?: string }) => {
		return `system prompt for ${input.mode ?? "unknown"}`;
	}),
}));

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
		enableAgentTeams: true,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		cwd: process.cwd(),
	};
}

const switchToActModeTool = createTool({
	name: "switch_to_act_mode",
	description: "Switch to act mode",
	inputSchema: {
		type: "object",
		properties: {},
	},
	execute: async () => "ok",
});

describe("createInteractiveModeSwitchTool", () => {
	function makeSwitchTool(config: Config) {
		const pendingModeChange: PendingModeChange = {
			current: null,
			source: null,
		};
		const tuiModeChanged: {
			current: ((mode: "plan" | "act") => void) | null;
		} = { current: vi.fn() };
		const tool = createInteractiveModeSwitchTool({
			config,
			pendingModeChange,
			tuiModeChanged,
		});
		return { tool, pendingModeChange, tuiModeChanged };
	}

	const toolContext = {
		agentId: "agent-1",
		iteration: 0,
	} as const;

	it("completes the run so the model never continues with plan-mode tools", () => {
		const config = makeConfig();
		config.mode = "plan";
		const { tool } = makeSwitchTool(config);

		// The act-mode tool set only exists after the session rebuild, which
		// happens between runs; without completesRun the model keeps working
		// with stale plan-mode tools after being told the switch succeeded.
		expect(tool.lifecycle?.completesRun).toBe(true);
	});

	it("queues a tool-sourced mode change and notifies the TUI", async () => {
		const config = makeConfig();
		config.mode = "plan";
		const { tool, pendingModeChange, tuiModeChanged } = makeSwitchTool(config);

		const result = await tool.execute({}, toolContext);

		expect(pendingModeChange).toEqual({ current: "act", source: "tool" });
		expect(tuiModeChanged.current).toHaveBeenCalledWith("act");
		expect(result).toContain("successfully switched to act mode");
	});

	it("errors instead of completing the run when already in act mode", async () => {
		const config = makeConfig();
		config.mode = "act";
		const { tool, pendingModeChange } = makeSwitchTool(config);

		// A successful result would end the run via completesRun even though
		// nothing changed, so the no-op case must surface as a tool error.
		await expect(tool.execute({}, toolContext)).rejects.toThrow(
			"Already in act mode.",
		);
		expect(pendingModeChange.current).toBeNull();
	});
});

describe("sendTurnWithActModeContinuation", () => {
	type TurnResult = { finishReason: string; iterations: number };

	function makeHarness(input: {
		initial: TurnResult | undefined;
		continuation?: TurnResult | undefined;
		modeChanges: Array<AppliedModeChange | undefined>;
	}) {
		const applied = [...input.modeChanges];
		const sendContinuationTurn = vi.fn(async () => input.continuation);
		return {
			sendContinuationTurn,
			run: () =>
				sendTurnWithActModeContinuation<TurnResult>({
					sendInitialTurn: async () => input.initial,
					sendContinuationTurn,
					applyPendingModeChange: async () => applied.shift(),
				}),
		};
	}

	it("continues the plan after a tool-initiated switch completes the run", async () => {
		const { run, sendContinuationTurn } = makeHarness({
			initial: { finishReason: "completed", iterations: 2 },
			continuation: { finishReason: "completed", iterations: 3 },
			modeChanges: [{ mode: "act", source: "tool" }, undefined],
		});

		const result = await run();

		expect(sendContinuationTurn).toHaveBeenCalledWith(
			ACT_MODE_CONTINUATION_PROMPT,
		);
		expect(result).toEqual({ finishReason: "completed", iterations: 5 });
	});

	it("does not continue after a UI-initiated mode change", async () => {
		// A Tab toggle can race a natural turn completion; a "ui" source must
		// never start executing a plan the user did not approve.
		const { run, sendContinuationTurn } = makeHarness({
			initial: { finishReason: "completed", iterations: 2 },
			modeChanges: [{ mode: "act", source: "ui" }],
		});

		const result = await run();

		expect(sendContinuationTurn).not.toHaveBeenCalled();
		expect(result).toEqual({ finishReason: "completed", iterations: 2 });
	});

	it("does not continue when the switch turn was aborted", async () => {
		const { run, sendContinuationTurn } = makeHarness({
			initial: { finishReason: "aborted", iterations: 1 },
			modeChanges: [{ mode: "act", source: "tool" }],
		});

		const result = await run();

		expect(sendContinuationTurn).not.toHaveBeenCalled();
		expect(result).toEqual({ finishReason: "aborted", iterations: 1 });
	});

	it("does not continue when no mode change was pending", async () => {
		const { run, sendContinuationTurn } = makeHarness({
			initial: { finishReason: "completed", iterations: 2 },
			modeChanges: [undefined],
		});

		const result = await run();

		expect(sendContinuationTurn).not.toHaveBeenCalled();
		expect(result).toEqual({ finishReason: "completed", iterations: 2 });
	});

	it("returns the switch turn result when the continuation yields nothing", async () => {
		const { run } = makeHarness({
			initial: { finishReason: "completed", iterations: 2 },
			continuation: undefined,
			modeChanges: [{ mode: "act", source: "tool" }, undefined],
		});

		const result = await run();

		expect(result).toEqual({ finishReason: "completed", iterations: 2 });
	});
});

describe("createModeSwitchNoticeTracker", () => {
	it("records a switch and clears it on consume", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");

		expect(tracker.consume()).toEqual({ from: "act", to: "plan" });
		expect(tracker.consume()).toBeNull();
	});

	it("cancels a round trip that returns to the mode the model last saw", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");
		tracker.record("plan", "act");

		expect(tracker.consume()).toBeNull();
	});

	it("keeps the original starting mode across chained switches", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");
		tracker.record("plan", "act");
		tracker.record("act", "plan");

		expect(tracker.consume()).toEqual({ from: "act", to: "plan" });
	});

	it("ignores a no-op switch", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("plan", "plan");

		expect(tracker.consume()).toBeNull();
	});
});

describe("applyInteractiveModeConfig", () => {
	beforeEach(() => {
		vi.mocked(resolveSystemPrompt).mockClear();
	});

	it("adds the mode switch tool when entering plan mode", async () => {
		const config = makeConfig();

		await applyInteractiveModeConfig({
			config,
			mode: "plan",
			switchToActModeTool,
		});

		expect(config.mode).toBe("plan");
		expect(config.extraTools).toEqual([switchToActModeTool]);
		expect(config.systemPrompt).toBe("system prompt for plan");
		expect(resolveSystemPrompt).toHaveBeenCalledWith({
			cwd: config.cwd,
			providerId: config.providerId,
			mode: "plan",
		});
	});

	it("removes the mode switch tool when entering act mode", async () => {
		const config = makeConfig();
		config.extraTools = [switchToActModeTool];

		await applyInteractiveModeConfig({
			config,
			mode: "act",
			switchToActModeTool,
		});

		expect(config.mode).toBe("act");
		expect(config.extraTools).toEqual([]);
		expect(config.systemPrompt).toBe("system prompt for act");
	});
});
