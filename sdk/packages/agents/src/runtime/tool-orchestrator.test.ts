import { describe, expect, it } from "vitest";
import type { ToolCallRecord } from "../index";
import { ToolOrchestrator } from "./tool-orchestrator";

function createOrchestrator(): ToolOrchestrator {
	return new ToolOrchestrator({
		getAgentId: () => "agent-1",
		getConversationId: () => "conversation-1",
		getParentAgentId: () => null,
		emit: () => {},
		dispatchLifecycle: async () => undefined,
		authorizeToolCall: async () => ({ allowed: true }),
	});
}

describe("ToolOrchestrator reminder cadence", () => {
	it("injects reminder only once per interval after threshold", () => {
		const orchestrator = createOrchestrator();
		const results = [
			{
				id: "tool-1",
				name: "example-tool",
				input: {},
				durationMs: 100,
				startedAt: new Date(),
				endedAt: new Date(),
				output: { ok: true },
			},
		] satisfies ToolCallRecord[];

		const at50 = orchestrator.buildToolResultMessage(results, 50, {
			afterIterations: 50,
			text: "reminder",
		});
		const at51 = orchestrator.buildToolResultMessage(results, 51, {
			afterIterations: 50,
			text: "reminder",
		});
		const at52 = orchestrator.buildToolResultMessage(results, 52, {
			afterIterations: 50,
			text: "reminder",
		});
		const at101 = orchestrator.buildToolResultMessage(results, 101, {
			afterIterations: 50,
			text: "reminder",
		});

		expect(at50.content).toHaveLength(1);
		expect(at51.content).toHaveLength(2);
		expect(at52.content).toHaveLength(1);
		expect(at101.content).toHaveLength(2);
	});

	it("includes tool name and query in structured tool results", () => {
		const orchestrator = createOrchestrator();
		const results = [
			{
				id: "tool-1",
				name: "run_commands",
				input: { commands: ["pwd"] },
				durationMs: 100,
				startedAt: new Date(),
				endedAt: new Date(),
				output: [{ query: "pwd", result: "/tmp", success: true }],
			},
			{
				id: "tool-2",
				name: "editor",
				input: { command: "create", path: "/tmp/file.txt" },
				durationMs: 100,
				startedAt: new Date(),
				endedAt: new Date(),
				output: null,
				error: "file_text is required",
			},
		] satisfies ToolCallRecord[];

		const message = orchestrator.buildToolResultMessage(results, 1, {
			afterIterations: 0,
			text: "reminder",
		});
		expect(message.content).toHaveLength(2);
		expect(message.content[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "tool-1",
			is_error: false,
		});
		expect((message.content[0] as { content: string }).content).toContain(
			'"toolName":"run_commands"',
		);
		expect((message.content[0] as { content: string }).content).toContain(
			'"query":"pwd"',
		);
		expect(message.content[1]).toMatchObject({
			type: "tool_result",
			tool_use_id: "tool-2",
			is_error: true,
		});
		expect((message.content[1] as { content: string }).content).toContain(
			'"toolName":"editor"',
		);
		expect((message.content[1] as { content: string }).content).toContain(
			'"query":"create:/tmp/file.txt"',
		);
	});
});
