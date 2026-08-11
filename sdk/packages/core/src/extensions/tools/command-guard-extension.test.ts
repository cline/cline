import type {
	AgentBeforeToolContext,
	AgentRuntimeStateSnapshot,
	AgentTool,
	AgentUnknownToolContext,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createPlanModeCommandGuardExtension,
	PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME,
} from "./command-guard-extension";

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		runId: "run-1",
		status: "running",
		iteration: 2,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		},
	} as unknown as AgentRuntimeStateSnapshot;
}

function makeContext(toolName: string, input: unknown): AgentBeforeToolContext {
	return {
		snapshot: makeSnapshot(),
		tool: { name: toolName } as AgentTool,
		toolCall: {
			type: "tool-call",
			toolCallId: "tool-call-1",
			toolName,
			input,
		},
		input,
	};
}

function makeTelemetryStub(): ITelemetryService {
	return {
		capture: vi.fn(),
		captureRequired: vi.fn(),
		setDistinctId: vi.fn(),
		setMetadata: vi.fn(),
		updateMetadata: vi.fn(),
		setCommonProperties: vi.fn(),
		updateCommonProperties: vi.fn(),
		isEnabled: vi.fn(() => true),
		recordCounter: vi.fn(),
		recordHistogram: vi.fn(),
		recordGauge: vi.fn(),
		flush: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	};
}

async function runBeforeTool(
	extension: ReturnType<typeof createPlanModeCommandGuardExtension>,
	context: AgentBeforeToolContext,
) {
	const hook = extension.hooks?.beforeTool;
	expect(hook).toBeTypeOf("function");
	return hook?.(context);
}

function makeUnknownToolContext(
	toolName: string,
	input: unknown = {},
): AgentUnknownToolContext {
	return {
		snapshot: makeSnapshot(),
		toolCall: {
			type: "tool-call",
			toolCallId: "tool-call-1",
			toolName,
			input,
		},
		input,
	};
}

async function runOnUnknownTool(
	extension: ReturnType<typeof createPlanModeCommandGuardExtension>,
	context: AgentUnknownToolContext,
) {
	const hook = extension.hooks?.onUnknownTool;
	expect(hook).toBeTypeOf("function");
	return hook?.(context);
}

describe("plan-mode command-guard extension", () => {
	it("declares the hooks capability under a stable name", () => {
		const extension = createPlanModeCommandGuardExtension();
		expect(extension.name).toBe(PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME);
		expect(extension.manifest.capabilities).toContain("hooks");
	});

	it("skips run_commands calls containing a file-editing command", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("run_commands", { commands: ["rm -rf build"] }),
		);

		expect(result?.skip).toBe(true);
		expect(result?.stop).toBeUndefined();
		expect(result?.reason).toContain("PLAN MODE");
		expect(result?.reason).toContain("`rm`");
	});

	it("rejects the whole call when any command in a batch is blocked", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("run_commands", {
				commands: ["git status", "echo hi > out.txt"],
			}),
		);

		expect(result?.skip).toBe(true);
		expect(result?.reason).toContain("output redirection");
	});

	it("allows read-only run_commands calls", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("run_commands", {
				commands: ["ls -la", "git log --oneline", "grep -rn foo src/"],
			}),
		);

		expect(result).toBeUndefined();
	});

	it("guards structured command input", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("run_commands", {
				commands: [{ command: "git", args: ["checkout", "main"] }],
			}),
		);

		expect(result?.skip).toBe(true);
		expect(result?.reason).toContain("`git checkout`");
	});

	it("ignores other tools", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("read_files", { files: [{ path: "/tmp/rm" }] }),
		);

		expect(result).toBeUndefined();
	});

	it("lets the tool report its own error for unparseable input", async () => {
		const extension = createPlanModeCommandGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("run_commands", { bogus: 42 }),
		);

		expect(result).toBeUndefined();
	});

	it("captures block telemetry without raw command content", async () => {
		const telemetry = makeTelemetryStub();
		const extension = createPlanModeCommandGuardExtension({ telemetry });

		await runBeforeTool(
			extension,
			makeContext("run_commands", {
				commands: ["rm -rf /workspace/secret-project"],
			}),
		);

		const captured = (telemetry.capture as ReturnType<typeof vi.fn>).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.plan_mode_command_blocked");
		expect(captured).toHaveLength(1);
		expect(captured[0].properties).toMatchObject({
			tool_name: "run_commands",
			blocked_construct: "`rm`",
			command_count: 1,
			agent_id: "agent-1",
			conversation_id: "conv-1",
			run_id: "run-1",
			iteration: 2,
			tool_call_id: "tool-call-1",
		});
		expect(JSON.stringify(captured[0].properties)).not.toContain(
			"secret-project",
		);
	});

	it("does not capture telemetry for allowed calls", async () => {
		const telemetry = makeTelemetryStub();
		const extension = createPlanModeCommandGuardExtension({ telemetry });

		await runBeforeTool(
			extension,
			makeContext("run_commands", { commands: ["ls"] }),
		);

		expect(telemetry.capture).not.toHaveBeenCalled();
	});

	describe("unknown edit-tool calls", () => {
		it.each([
			"editor",
			"apply_patch",
			"write_to_file",
			"replace_in_file",
			"edit_file",
			"create_file",
			"delete_file",
			"str_replace_editor",
			"str_replace_based_edit_tool",
		])("replaces the unknown-tool error for %s", async (toolName) => {
			const extension = createPlanModeCommandGuardExtension();
			const result = await runOnUnknownTool(
				extension,
				makeUnknownToolContext(toolName, { path: "a.ts" }),
			);

			expect(result?.reason).toContain("PLAN MODE");
			expect(result?.reason).toContain("blocked in plan mode");
			expect(result?.reason).toContain("not an input formatting error");
			// Never echo the attempted name back as a real file-editing tool:
			// some blocked names do not exist in any mode.
			expect(result?.reason).not.toContain(toolName);
		});

		it("matches edit-tool names case-insensitively", async () => {
			const extension = createPlanModeCommandGuardExtension();
			const result = await runOnUnknownTool(
				extension,
				makeUnknownToolContext("Write_To_File"),
			);

			expect(result?.reason).toContain("blocked in plan mode");
		});

		it("leaves unrelated unknown tools to the default error", async () => {
			const extension = createPlanModeCommandGuardExtension();
			const result = await runOnUnknownTool(
				extension,
				makeUnknownToolContext("mystery_tool"),
			);

			expect(result).toBeUndefined();
		});

		it("captures block telemetry without raw input content", async () => {
			const telemetry = makeTelemetryStub();
			const extension = createPlanModeCommandGuardExtension({ telemetry });

			await runOnUnknownTool(
				extension,
				makeUnknownToolContext("editor", {
					path: "secret-project/config.json",
					new_text: "top-secret-content",
				}),
			);

			const captured = (
				telemetry.capture as ReturnType<typeof vi.fn>
			).mock.calls
				.map((call) => call[0])
				.filter((event) => event.event === "sdk.plan_mode_edit_tool_blocked");
			expect(captured).toHaveLength(1);
			expect(captured[0].properties).toMatchObject({
				tool_name: "editor",
				agent_id: "agent-1",
				conversation_id: "conv-1",
				run_id: "run-1",
				iteration: 2,
				tool_call_id: "tool-call-1",
			});
			expect(JSON.stringify(captured[0].properties)).not.toContain(
				"secret-project",
			);
			expect(JSON.stringify(captured[0].properties)).not.toContain(
				"top-secret-content",
			);
		});

		it("does not capture telemetry for unrelated unknown tools", async () => {
			const telemetry = makeTelemetryStub();
			const extension = createPlanModeCommandGuardExtension({ telemetry });

			await runOnUnknownTool(extension, makeUnknownToolContext("mystery_tool"));

			expect(telemetry.capture).not.toHaveBeenCalled();
		});
	});
});
