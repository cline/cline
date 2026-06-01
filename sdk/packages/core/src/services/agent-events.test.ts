import type { ITelemetryService } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { CoreSessionConfig } from "../types/config";
import type { AgentEventContext } from "./agent-events";
import { handleAgentEvent } from "./agent-events";

function createContext(): AgentEventContext & {
	capture: ReturnType<typeof vi.fn>;
} {
	const capture = vi.fn();
	const telemetry = {
		capture,
		captureRequired: vi.fn(),
		setDistinctId: vi.fn(),
		updateCommonProperties: vi.fn(),
		identify: vi.fn(),
	} as unknown as ITelemetryService;
	return {
		sessionId: "session-1",
		config: {
			telemetry,
			providerId: "openai",
			modelId: "gpt-5.5",
		} as CoreSessionConfig,
		liveSession: undefined,
		usageBySession: new Map(),
		aggregateUsageBySession: new Map(),
		persistMessages: vi.fn(),
		emit: vi.fn(),
		capture,
	};
}

function capturedToolUsageSuccess(ctx: { capture: ReturnType<typeof vi.fn> }) {
	const call = ctx.capture.mock.calls.find(
		([event]) => event?.event === "task.tool_used",
	);
	return call?.[0]?.properties?.success;
}

describe("handleAgentEvent tool telemetry", () => {
	it("marks run_commands tool usage unsuccessful when a command result timed out", () => {
		const ctx = createContext();

		handleAgentEvent(ctx, {
			type: "content_end",
			contentType: "tool",
			toolName: "run_commands",
			toolCallId: "call-1",
			output: [
				{
					success: false,
					result: "",
					error: "Command failed: Command timed out after 30000ms",
				},
			],
		});

		expect(capturedToolUsageSuccess(ctx)).toBe(false);
	});

	it("keeps run_commands tool usage successful for ordinary non-zero exits", () => {
		const ctx = createContext();

		handleAgentEvent(ctx, {
			type: "content_end",
			contentType: "tool",
			toolName: "run_commands",
			toolCallId: "call-1",
			output: [
				{
					success: false,
					result: "",
					error: "Command failed: Command exited with code 1",
				},
			],
		});

		expect(capturedToolUsageSuccess(ctx)).toBe(true);
	});

	it("keeps run_commands tool usage successful when all command results succeeded", () => {
		const ctx = createContext();

		handleAgentEvent(ctx, {
			type: "content_end",
			contentType: "tool",
			toolName: "run_commands",
			toolCallId: "call-1",
			output: [{ success: true, result: "happy_path_done\n" }],
		});

		expect(capturedToolUsageSuccess(ctx)).toBe(true);
	});

	it("does not infer failure from other tools' structured output", () => {
		const ctx = createContext();

		handleAgentEvent(ctx, {
			type: "content_end",
			contentType: "tool",
			toolName: "read_files",
			toolCallId: "call-1",
			output: [{ success: false }],
		});

		expect(capturedToolUsageSuccess(ctx)).toBe(true);
	});
});
