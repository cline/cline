import { getEventListeners } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PendingToolCall, Tool, ToolContext } from "../types";
import {
	createTool,
	createToolRegistry,
	executeTool,
	executeToolsInParallel,
	executeToolsSequentially,
	executeToolWithRetry,
	formatToolCallRecord,
	formatToolResult,
	formatToolResultsSummary,
	getToolNames,
	validateToolDefinition,
	validateToolInput,
	validateTools,
} from "./index";

const baseContext: ToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("tools utilities", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("creates tools from zod/json schema and validates definitions", () => {
		const jsonTool = createTool({
			name: "echo",
			description: "Echo value",
			inputSchema: {
				type: "object",
				properties: { value: { type: "string" } },
				required: ["value"],
			},
			execute: async ({ value }: { value: string }) => value,
		});

		const zodTool = createTool({
			name: "math",
			description: "Math tool",
			inputSchema: z.object({ a: z.number(), b: z.number() }),
			execute: async ({ a, b }) => a + b,
		});

		expect(jsonTool.timeoutMs).toBe(30000);
		expect(zodTool.inputSchema.type).toBe("object");
		expect(validateToolDefinition(jsonTool as Tool)).toEqual({
			valid: true,
			errors: [],
		});
	});

	it("validates tool collections and inputs", () => {
		const tool = createTool({
			name: "parse",
			description: "Parse record",
			inputSchema: {
				type: "object",
				properties: {
					count: { type: "integer" },
					name: { type: "string" },
				},
				required: ["count"],
			},
			execute: async () => "ok",
		});

		validateTools([tool]);
		expect(() => validateTools([tool, tool])).toThrow(
			"Duplicate tool name: parse",
		);

		expect(validateToolInput(tool, { count: 3, name: "x" }).valid).toBe(true);
		const missingCount = validateToolInput(tool, { name: "x" });
		expect(missingCount.valid).toBe(false);
		expect(missingCount.error).toContain("expected number");
		expect(missingCount.error).toContain("count");
		const nonInteger = validateToolInput(tool, { count: 1.2 });
		expect(nonInteger.valid).toBe(false);
		expect(nonInteger.error).toContain("expected int");
		expect(nonInteger.error).toContain("count");
	});

	it("builds registries and handles duplicate tool names", () => {
		const a = createTool({
			name: "a",
			description: "a",
			inputSchema: { type: "object", properties: {} },
			execute: async () => "a",
		});
		const b = createTool({
			name: "b",
			description: "b",
			inputSchema: { type: "object", properties: {} },
			execute: async () => "b",
		});

		const registry = createToolRegistry([a, b]);
		expect(getToolNames(registry)).toEqual(["a", "b"]);
		expect(() => createToolRegistry([a, a])).toThrow("Duplicate tool name: a");
	});

	it("executes tools with timeout, retry, and authorization", async () => {
		const transient = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce({ ok: true });
		const retryTool = createTool({
			name: "retry_tool",
			description: "retry",
			inputSchema: { type: "object", properties: {} },
			execute: transient,
			maxRetries: 1,
			retryable: true,
		});

		const retryResult = await executeToolWithRetry(retryTool, {}, baseContext);
		expect(retryResult.error).toBeUndefined();
		expect(retryResult.output).toEqual({ ok: true });

		const timeoutTool = createTool({
			name: "slow_tool",
			description: "slow",
			inputSchema: { type: "object", properties: {} },
			timeoutMs: 5,
			execute: async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				return "late";
			},
		});
		const timeoutResult = await executeTool(timeoutTool, {}, baseContext);
		expect(timeoutResult.error).toContain("timed out");
	});

	it("does not leak abort listeners across tool executions", async () => {
		const controller = new AbortController();
		const context: ToolContext = {
			...baseContext,
			abortSignal: controller.signal,
		};
		const tool = createTool({
			name: "noop",
			description: "noop",
			inputSchema: { type: "object", properties: {} },
			execute: async () => "ok",
		});

		for (let i = 0; i < 25; i++) {
			const result = await executeTool(tool, {}, context);
			expect(result.error).toBeUndefined();
		}

		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});

	it("executes parallel and sequential calls with observer + authorizer", async () => {
		const successTool = createTool({
			name: "success",
			description: "ok",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({ ok: true }),
			retryable: false,
		});
		const denyTool = createTool({
			name: "deny",
			description: "deny",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({ denied: false }),
			retryable: false,
		});

		const registry = createToolRegistry([successTool, denyTool]);
		const calls: PendingToolCall[] = [
			{ id: "1", name: "success", input: {} },
			{ id: "2", name: "deny", input: {} },
			{ id: "3", name: "missing", input: {} },
		];

		const starts: string[] = [];
		const ends: string[] = [];

		const observer = {
			onToolCallStart: async (call: PendingToolCall) => {
				starts.push(call.name);
			},
			onToolCallEnd: async (record: { name: string }) => {
				ends.push(record.name);
			},
		};

		const authorizer = {
			authorize: async (call: PendingToolCall) =>
				call.name === "deny"
					? { allowed: false as const, reason: "blocked by policy" }
					: { allowed: true as const },
		};

		const parallel = await executeToolsInParallel(
			registry,
			calls,
			baseContext,
			observer,
			authorizer,
		);
		expect(parallel).toHaveLength(3);
		expect(parallel.find((r) => r.name === "success")?.error).toBeUndefined();
		expect(parallel.find((r) => r.name === "deny")?.error).toBe(
			"blocked by policy",
		);
		expect(parallel.find((r) => r.name === "missing")?.error).toContain(
			"Unknown tool",
		);

		const sequential = await executeToolsSequentially(
			registry,
			calls,
			baseContext,
			observer,
			authorizer,
		);
		expect(sequential).toHaveLength(3);
		expect(starts).toContain("success");
		expect(ends).toContain("missing");
	});

	it("respects max concurrency in parallel tool execution", async () => {
		let active = 0;
		let maxActive = 0;
		const slowTool = createTool({
			name: "slow",
			description: "slow",
			inputSchema: { type: "object", properties: {} },
			execute: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 10));
				active -= 1;
				return { ok: true };
			},
			retryable: false,
		});
		const registry = createToolRegistry([slowTool]);
		const calls: PendingToolCall[] = [
			{ id: "1", name: "slow", input: {} },
			{ id: "2", name: "slow", input: {} },
			{ id: "3", name: "slow", input: {} },
			{ id: "4", name: "slow", input: {} },
		];

		const result = await executeToolsInParallel(
			registry,
			calls,
			baseContext,
			undefined,
			undefined,
			{ maxConcurrency: 2 },
		);

		expect(result).toHaveLength(4);
		expect(maxActive).toBeLessThanOrEqual(2);
	});

	it("formats tool output and summaries", () => {
		expect(formatToolResult("hello")).toBe("hello");
		expect(formatToolResult({ ok: true })).toBe('{"ok":true}');
		expect(formatToolResult(undefined)).toBe("null");
		expect(formatToolResult(null, "boom")).toBe('{"error":"boom"}');

		const record = {
			id: "call-1",
			name: "echo",
			input: { value: "x" },
			output: "x",
			durationMs: 12,
			startedAt: new Date("2026-01-01T00:00:00.000Z"),
			endedAt: new Date("2026-01-01T00:00:00.012Z"),
		};
		const summary = formatToolResultsSummary([record]);
		expect(summary).toContain("echo: SUCCESS (12ms)");
		expect(formatToolResultsSummary([])).toBe("No tools were called.");

		const detail = formatToolCallRecord(record);
		expect(detail).toContain("Tool: echo");
		expect(detail).toContain("Status: SUCCESS");
	});
});
