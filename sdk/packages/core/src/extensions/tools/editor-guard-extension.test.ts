import type {
	AgentBeforeToolContext,
	AgentRuntimeStateSnapshot,
	AgentTool,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createPlanModeEditorGuardExtension,
	PLAN_MODE_EDITOR_GUARD_EXTENSION_NAME,
} from "./editor-guard-extension";

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
	extension: ReturnType<typeof createPlanModeEditorGuardExtension>,
	context: AgentBeforeToolContext,
) {
	const hook = extension.hooks?.beforeTool;
	expect(hook).toBeTypeOf("function");
	return hook?.(context);
}

describe("plan-mode editor-guard extension", () => {
	it("declares the hooks capability under a stable name", () => {
		const extension = createPlanModeEditorGuardExtension();
		expect(extension.name).toBe(PLAN_MODE_EDITOR_GUARD_EXTENSION_NAME);
		expect(extension.manifest.capabilities).toContain("hooks");
	});

	it("skips editor calls with a plan-mode error", async () => {
		const extension = createPlanModeEditorGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("editor", {
				path: "/workspace/project/src/main.ts",
				new_text: "const x = 1;",
			}),
		);

		expect(result?.skip).toBe(true);
		expect(result?.stop).toBeUndefined();
		expect(result?.reason).toContain("PLAN MODE");
		expect(result?.reason).toContain("editor");
		expect(result?.reason).toContain("act mode");
	});

	it("skips apply_patch calls too", async () => {
		const extension = createPlanModeEditorGuardExtension();
		const result = await runBeforeTool(
			extension,
			makeContext("apply_patch", { patch: "*** Begin Patch" }),
		);

		expect(result?.skip).toBe(true);
		expect(result?.reason).toContain("apply_patch");
	});

	it("ignores non-editing tools", async () => {
		const extension = createPlanModeEditorGuardExtension();
		for (const toolName of [
			"read_files",
			"search_codebase",
			"run_commands",
			"fetch_web_content",
		]) {
			const result = await runBeforeTool(
				extension,
				makeContext(toolName, { commands: ["ls"] }),
			);
			expect(result).toBeUndefined();
		}
	});

	it("captures block telemetry without raw tool input content", async () => {
		const telemetry = makeTelemetryStub();
		const extension = createPlanModeEditorGuardExtension({ telemetry });

		await runBeforeTool(
			extension,
			makeContext("editor", {
				path: "/workspace/secret-project/src/main.ts",
				new_text: "const secret = 'top-secret';",
			}),
		);

		const captured = (telemetry.capture as ReturnType<typeof vi.fn>).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.plan_mode_tool_blocked");
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
		expect(JSON.stringify(captured[0].properties)).not.toContain("top-secret");
	});

	it("does not capture telemetry for allowed calls", async () => {
		const telemetry = makeTelemetryStub();
		const extension = createPlanModeEditorGuardExtension({ telemetry });

		await runBeforeTool(extension, makeContext("read_files", { files: [] }));

		expect(telemetry.capture).not.toHaveBeenCalled();
	});
});
