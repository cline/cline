/**
 * Differential parity: the frame path (frame → assemble →
 * FrameMessageBridge) must produce the same ClineMessages as the v1
 * translator (translateAgentEvent) for the core agent-event surface.
 *
 * Both paths mint message ids from identically-seeded counters, so any
 * behavioral divergence shows up as a row difference — content, order,
 * or ts. Generated traces cover the grammar's legal shapes (including
 * the warts); handcrafted traces pin the edges the generator cannot
 * aim at.
 *
 * Traces exercising surfaces not yet ported to the bridge (terminal
 * error rows, compaction dividers, tool-specific renderings) are
 * excluded here — the switchover checklist in the design doc maps each
 * to the pinned v1 translator tests that gate its port.
 */

import { StreamAssembler } from "@cline/core/frames"
import { type AgentEvent, AgentEventFramer, generateLegalV1Trace } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { FrameMessageBridge } from "./frame-message-bridge"
import { MessageIdMinter } from "./message-id-minter"
import { MessageTranslatorState, translateAgentEvent } from "./message-translator"
import { DEFAULT_TOOL_APPROVAL_DENIAL_REASON, USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON } from "./tool-approval-denial"

/** The v1 oracle: the production translator, unchanged. */
function v1Messages(events: readonly AgentEvent[], mode: "plan" | "act" = "act"): ClineMessage[] {
	const state = new MessageTranslatorState(new MessageIdMinter(), undefined, () => mode)
	const out: ClineMessage[] = []
	for (const event of events) {
		out.push(...translateAgentEvent(event, state))
	}
	return out
}

/** The v2 path: frame → assemble → bridge sinks. */
function v2Messages(events: readonly AgentEvent[], mode: "plan" | "act" = "act"): ClineMessage[] {
	const minter = new MessageIdMinter()
	const bridge = new FrameMessageBridge({ nextTs: () => minter.nextId(), getUiMode: () => mode })
	const assembler = new StreamAssembler(bridge)
	assembler.pushAll(new AgentEventFramer().frameAll(events))
	return bridge.takeMessages()
}

function expectParity(events: readonly AgentEvent[], mode?: "plan" | "act"): void {
	const v1 = v1Messages(events, mode)
	const v2 = v2Messages(events, mode)
	expect(v2).toEqual(v1)
}

describe("FrameMessageBridge differential parity", () => {
	it("generated traces: frame path equals v1 translator output", () => {
		const traces: AgentEvent[][] = []
		for (let seed = 1; traces.length < 100; seed += 1) {
			const events = generateLegalV1Trace(seed, { maxEvents: 40 })
			// Terminal non-recoverable errors are now a ported surface — the
			// framer preserves plain-object and Error message shapes, so the
			// api_req_failed pair renders identically on both paths.
			// Concurrently open tools: v1 reuses one streamingToolTs across
			// them (their partial rows collide in the message store); the
			// bridge gives each tool block its own identity — intended
			// divergence, whitelisted like the CLI's done(error) case.
			let openTools = 0
			let concurrent = false
			for (const e of events) {
				if (e.type === "content_start" && e.contentType === "tool") openTools += 1
				if (e.type === "content_end" && e.contentType === "tool") openTools -= 1
				if (openTools > 1) concurrent = true
			}
			// Text/reasoning blocks left open across an iteration boundary:
			// v1's iteration_start reset() re-mints the streaming ts while
			// the framer keeps one block open — the real adapter closes
			// content within its iteration, so this shape is unmodeled in
			// the tables; excluded (see the design doc's framer note).
			let textOpen = false
			let reasoningOpen = false
			let danglingAtBoundary = false
			for (const e of events) {
				if (e.type === "content_start" && e.contentType === "text") textOpen = true
				if (e.type === "content_end" && e.contentType === "text") textOpen = false
				if (e.type === "content_start" && e.contentType === "reasoning") reasoningOpen = true
				if (e.type === "content_end" && e.contentType === "reasoning") reasoningOpen = false
				if (e.type === "iteration_start" || e.type === "iteration_end") {
					if (textOpen || reasoningOpen) danglingAtBoundary = true
				}
			}
			if (danglingAtBoundary) {
				continue
			}
			if (concurrent) {
				continue
			}
			traces.push(events)
		}
		expect(traces.length).toBe(100)
		for (const events of traces) {
			const v1 = v1Messages(events)
			const v2 = v2Messages(events)
			expect(v2).toEqual(v1)
		}
	})

	it("streaming text finalizes and retags as completion (act mode)", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_start", contentType: "text", text: "He", accumulated: "He" },
			{ type: "content_start", contentType: "text", text: "llo", accumulated: "Hello" },
			{ type: "content_end", contentType: "text", text: "Hello" },
			{ type: "iteration_end", iteration: 1, hadToolCalls: false, toolCallCount: 0 },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("plan mode retags as plan_completion_result", () => {
		expectParity(
			[
				{ type: "iteration_start", iteration: 1 },
				{ type: "content_end", contentType: "text", text: "the plan" },
				{ type: "done", text: "", reason: "completed", iterations: 1 },
			],
			"plan",
		)
	})

	it("max_iterations and mistake_limit complete the turn but never retag", () => {
		for (const reason of ["max_iterations", "mistake_limit"] as const) {
			expectParity([
				{ type: "iteration_start", iteration: 1 },
				{ type: "content_end", contentType: "text", text: "partial answer" },
				{ type: "done", text: "", reason, iterations: 3 },
			])
		}
	})

	it("tool activity drops the retag candidate; later text re-records it", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "first" },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "read_file",
				input: { path: "/tmp/x" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "read_file", output: "ok" },
			{ type: "content_end", contentType: "text", text: "second" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})
})

describe("FrameMessageBridge differential parity (edges)", () => {
	it("reasoning streams accumulated text and finalizes", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_start", contentType: "reasoning", reasoning: "th" },
			{ type: "content_start", contentType: "reasoning", reasoning: "inking" },
			{ type: "content_end", contentType: "reasoning", reasoning: "thinking" },
			{ type: "content_end", contentType: "text", text: "answer" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("interleaved reasoning and text keep separate rows", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_start", contentType: "text", text: "a", accumulated: "a" },
			{ type: "content_start", contentType: "reasoning", reasoning: "r" },
			{ type: "content_start", contentType: "text", text: "b", accumulated: "ab" },
			{ type: "content_end", contentType: "reasoning", reasoning: "r" },
			{ type: "content_end", contentType: "text", text: "ab" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("final without streamed deltas (W2) still renders the final row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "whole answer" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("aborted turn with dangling tool and text is silent for the dangling blocks (W3)", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_start", contentType: "text", text: "ha", accumulated: "ha" },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "read_file",
				input: { path: "/tmp/x" },
			},
			{ type: "content_update", contentType: "tool", toolCallId: "c1", update: { p: 1 } },
			{ type: "done", text: "", reason: "aborted", iterations: 1 },
		])
	})

	it("tool close with error renders the tool row plus an error row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "read_file",
				input: { path: "/tmp/x" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "read_file", error: "boom" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("iteration markers emit api_req_started; usage fills the cost row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "x" },
			{
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 4,
				cacheWriteTokens: 2,
				cost: 0.5,
				totalInputTokens: 10,
				totalOutputTokens: 5,
			},
			{ type: "iteration_end", iteration: 1, hadToolCalls: false, toolCallCount: 0 },
			{ type: "iteration_start", iteration: 2 },
			{ type: "content_end", contentType: "text", text: "y" },
			{ type: "done", text: "", reason: "completed", iterations: 2 },
		])
	})

	it("status and plain notices render as info rows; internal ones are dropped", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "notice", noticeType: "status", message: "t" },
			{ type: "notice", noticeType: "status", message: "compaction-budget-adjusted" },
			{ type: "notice", noticeType: "stop", message: "note text" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("recoverable errors emit nothing and the turn continues", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "error", error: new Error("transient"), iteration: 1, recoverable: true },
			{ type: "content_end", contentType: "text", text: "still fine" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("consecutive text blocks each mint their own row identity", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_start", contentType: "text", text: "a", accumulated: "a" },
			{ type: "content_end", contentType: "text", text: "a" },
			{ type: "content_start", contentType: "text", text: "b", accumulated: "b" },
			{ type: "content_end", contentType: "text", text: "b" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("empty final text never becomes a retag candidate", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "   " },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})
})

describe("FrameMessageBridge differential parity (tool renderings)", () => {
	it("attempt_completion renders the green box and suppresses the retag", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "preamble" },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "attempt_completion",
				input: { result: "All done." },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "attempt_completion" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("submit_and_exit uses the summary field", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "submit_and_exit",
				input: { summary: "Resolved." },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "submit_and_exit" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("command tools render the running marker and completed output", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "run_commands",
				input: { commands: ["ls -la"] },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "run_commands", output: "total 0" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("command tools render the error output", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "execute_command",
				input: { commands: "make" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "execute_command", error: "exit 2" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("MCP tools render use_mcp_server plus the response row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "myserver__get_data",
				input: { query: "x" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "myserver__get_data", output: "data!" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("MCP tool errors render the response row with the error", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "myserver__get_data",
				input: { query: "x" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "myserver__get_data", error: "timeout" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("read_files multi-file split carries paths and line ranges", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "read_files",
				input: {
					files: [{ path: "/src/a.ts", start_line: 3, end_line: 9 }, { path: "/src/b.ts" }, { path: "/src/c.ts" }],
				},
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "read_files" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("read_files single file falls through to the generic row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "read_files",
				input: { files: [{ path: "/src/a.ts" }] },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "read_files", output: "contents" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("apply_patch multi-file split renders one row per file", () => {
		const patch = [
			"*** Begin Patch",
			"*** Update File: /a.ts",
			"@@",
			"-x",
			"+y",
			"*** Update File: /b.ts",
			"@@",
			"-1",
			"+2",
			"*** End Patch",
		].join("\n")
		expectParity([
			{ type: "iteration_start", iteration: 1 },

			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "apply_patch",
				input: { patch },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "apply_patch", output: "ok" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("apply_patch error falls through to the generic error rows", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "apply_patch",
				input: { patch: "*** Begin Patch\n*** Update File: /a.ts\n@@\n-x\n+y\n*** End Patch" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "apply_patch", error: "conflict" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("ask_question is suppressed at open and close", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "c1",
				toolName: "ask_question",
				input: { question: "Continue?" },
			},
			{ type: "content_end", contentType: "tool", toolCallId: "c1", toolName: "ask_question" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})
})

describe("FrameMessageBridge differential parity (compaction and errors)", () => {
	const compactionNotice = (phase: string, extra: Record<string, unknown> = {}) => ({
		type: "notice" as const,
		noticeType: "status" as const,
		message: "auto-compacting",
		metadata: { kind: "auto_compaction", phase, ...extra },
	})

	it("compaction started then completed updates the divider in place", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			compactionNotice("started"),
			compactionNotice("completed", { tokensBefore: 100, tokensAfter: 50, messagesBefore: 10, messagesAfter: 4 }),
			{ type: "content_end", contentType: "text", text: "done" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("compaction skipped finalizes the divider", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			compactionNotice("started"),
			compactionNotice("skipped"),
			{ type: "content_end", contentType: "text", text: "done" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("a dangling compaction divider finalizes as cancelled at done", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			compactionNotice("started"),
			{ type: "content_end", contentType: "text", text: "partial" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("a dangling compaction divider finalizes as failed at a terminal error", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			compactionNotice("started"),
			{ type: "error", error: { message: "provider down" } as unknown as Error, iteration: 1, recoverable: false },
		])
	})

	it("a dangling compaction divider finalizes as cancelled at done(reason:error)", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			compactionNotice("started"),
			{ type: "done", text: "", reason: "error", iterations: 1 },
		])
	})

	it("terminal error renders the api_req_failed pair (plain-object error)", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "error",
				error: { message: "API rate limit exceeded" } as unknown as Error,
				iteration: 1,
				recoverable: false,
			},
		])
	})

	it("terminal error renders the pair for Error instances", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "error", error: new Error("fatal"), iteration: 1, recoverable: false },
		])
	})

	it("terminal error reshapes insufficient-credits JSON for the ErrorRow UI", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "error",
				error: {
					message: JSON.stringify({ error: { code: "insufficient_credits", message: "Out of credits" } }),
				} as unknown as Error,
				iteration: 1,
				recoverable: false,
			},
		])
	})

	it("terminal error reshapes with provider, model, and error class context", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{
				type: "error",
				error: { message: "boom" } as unknown as Error,
				errorClass: "auth",
				iteration: 1,
				recoverable: false,
			},
		])
	})

	it("done(reason:error) emits no rows", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "partial answer" },
			{ type: "done", text: "", reason: "error", iterations: 1 },
		])
	})
})

describe("FrameMessageBridge differential parity (spawn_agent aggregation)", () => {
	const spawnStart = (toolCallId: string, task: string): AgentEvent => ({
		type: "content_start",
		contentType: "tool",
		toolCallId,
		toolName: "spawn_agent",
		input: { task },
	})
	const spawnProgress = (toolCallId: string, update: unknown): AgentEvent => ({
		type: "content_update",
		contentType: "tool",
		toolCallId,
		toolName: "spawn_agent",
		update,
	})
	const spawnEnd = (toolCallId: string, extra: { output?: unknown; error?: string } = {}): AgentEvent => ({
		type: "content_end",
		contentType: "tool",
		toolCallId,
		toolName: "spawn_agent",
		...extra,
	})
	const spawnOutput = (text: string, inputTokens: number, outputTokens: number) => ({
		text,
		iterations: 2,
		finishReason: "completed",
		usage: { inputTokens, outputTokens },
	})

	it("a single spawn renders prompts, running status, completed status, and usage", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "research the API"),
			spawnProgress("s1", { toolCalls: 2, inputTokens: 100, outputTokens: 20, latestToolCall: "read_file" }),
			spawnEnd("s1", { output: spawnOutput("found it", 300, 40) }),
			{ type: "iteration_end", iteration: 1, hadToolCalls: true, toolCallCount: 1 },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("parallel spawns aggregate into one prompts row and one status row", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "task one"),
			spawnStart("s2", "task two"),
			spawnProgress("s2", { toolCalls: 1, contextTokens: 5000, contextWindow: 200000, contextUsagePercentage: 2.5 }),
			spawnProgress("s1", { toolCalls: 3, totalCost: 0.02 }),
			spawnEnd("s2", { output: spawnOutput("two done", 10, 5) }),
			spawnProgress("s1", { toolCalls: 4 }),
			spawnEnd("s1", { output: spawnOutput("one done", 20, 8) }),
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("a failed spawn marks the group failed once every spawn has closed", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "will fail"),
			spawnStart("s2", "will pass"),
			spawnEnd("s1", { error: "sub-agent crashed" }),
			spawnEnd("s2", { output: spawnOutput("ok", 1, 1) }),
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("a spawn closing after the iteration boundary reports to the reset group", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "long task"),
			{ type: "iteration_end", iteration: 1, hadToolCalls: true, toolCallCount: 1 },
			{ type: "iteration_start", iteration: 2 },
			spawnProgress("s1", { toolCalls: 9 }),
			spawnEnd("s1", { output: spawnOutput("late", 1, 1) }),
			{ type: "done", text: "", reason: "completed", iterations: 2 },
		])
	})

	it("non-object progress and output payloads leave the entry unchanged", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "task"),
			spawnProgress("s1", "plain string"),
			spawnEnd("s1", { output: "not an object" }),
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})

	it("an aborted turn leaves dangling spawns silent (W3)", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			spawnStart("s1", "task"),
			spawnProgress("s1", { toolCalls: 1 }),
			{ type: "done", text: "", reason: "aborted", iterations: 1 },
		])
	})

	it("spawn_agent after text drops the completion retag like any tool", () => {
		expectParity([
			{ type: "iteration_start", iteration: 1 },
			{ type: "content_end", contentType: "text", text: "delegating" },
			spawnStart("s1", "task"),
			spawnEnd("s1", { output: spawnOutput("done", 1, 1) }),
			{ type: "content_end", contentType: "text", text: "summary" },
			{ type: "done", text: "", reason: "completed", iterations: 1 },
		])
	})
})

/**
 * Approval decisions are not v1 agent events: the coordinator hands them
 * to each path out of band (v1: the translator state's side tables; v2:
 * an annotation frame). A script interleaves both, applied to each path
 * at the same point, and the messages must still be equal.
 */
type ApprovalStep =
	| { agentEvent: AgentEvent }
	| { approved: { toolCallId: string; messageTs: number } }
	| { denied: { toolCallId: string; toolName: string; reason: string } }

function v1ApprovalMessages(script: readonly ApprovalStep[]): ClineMessage[] {
	const state = new MessageTranslatorState(new MessageIdMinter(), undefined, () => "act")
	const out: ClineMessage[] = []
	for (const step of script) {
		if ("agentEvent" in step) {
			out.push(...translateAgentEvent(step.agentEvent, state))
		} else if ("approved" in step) {
			state.recordApprovedToolMessageTs(step.approved.toolCallId, step.approved.messageTs)
		} else {
			state.recordDeniedToolApproval(step.denied.toolCallId, step.denied.toolName, step.denied.reason)
		}
	}
	return out
}

function v2ApprovalMessages(script: readonly ApprovalStep[]): ClineMessage[] {
	const minter = new MessageIdMinter()
	const bridge = new FrameMessageBridge({ nextTs: () => minter.nextId(), getUiMode: () => "act" })
	const assembler = new StreamAssembler(bridge)
	const framer = new AgentEventFramer()
	for (const step of script) {
		if ("agentEvent" in step) {
			assembler.pushAll(framer.frameEvent(step.agentEvent))
		} else if ("approved" in step) {
			assembler.pushAll(
				framer.annotateBlock(step.approved.toolCallId, {
					kind: "annotation",
					ns: "approval",
					body: { state: "approved", messageTs: step.approved.messageTs },
				}),
			)
		} else {
			assembler.pushAll(
				framer.annotateBlock(step.denied.toolCallId, {
					kind: "annotation",
					ns: "approval",
					body: { state: "denied", reason: step.denied.reason },
				}),
			)
		}
	}
	return bridge.takeMessages()
}

function expectApprovalParity(script: readonly ApprovalStep[]): ClineMessage[] {
	const v1 = v1ApprovalMessages(script)
	const v2 = v2ApprovalMessages(script)
	expect(v2).toEqual(v1)
	return v2
}

describe("FrameMessageBridge differential parity (approval annotations)", () => {
	const ev = (agentEvent: AgentEvent): ApprovalStep => ({ agentEvent })
	const toolStart = (toolCallId: string, toolName: string, input: unknown): ApprovalStep =>
		ev({ type: "content_start", contentType: "tool", toolCallId, toolName, input })
	const toolEnd = (toolCallId: string, toolName: string, extra: { output?: unknown; error?: string } = {}): ApprovalStep =>
		ev({ type: "content_end", contentType: "tool", toolCallId, toolName, ...extra })

	it("an approved tool renders on its approval ask row instead of minting a new one", () => {
		// The ask row's ts (900) is minted by the coordinator from the shared
		// minter in production; here it is any id neither path would mint.
		const messages = expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ approved: { toolCallId: "c1", messageTs: 900 } },
			toolStart("c1", "read_file", { path: "/tmp/x" }),
			toolEnd("c1", "read_file", { output: "ok" }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
		const toolRows = messages.filter((message) => message.say === "tool")
		expect(toolRows.length).toBeGreaterThan(0)
		expect(toolRows.every((message) => message.ts === 900)).toBe(true)
	})

	it("approved command, MCP, and completion tools adopt the ask row identity too", () => {
		expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ approved: { toolCallId: "c1", messageTs: 901 } },
			toolStart("c1", "run_commands", { commands: ["ls"] }),
			toolEnd("c1", "run_commands", { output: "a\nb" }),
			{ approved: { toolCallId: "c2", messageTs: 902 } },
			toolStart("c2", "github__search", { q: "x" }),
			toolEnd("c2", "github__search", { output: "hits" }),
			{ approved: { toolCallId: "c3", messageTs: 903 } },
			toolStart("c3", "attempt_completion", { result: "done" }),
			toolEnd("c3", "attempt_completion"),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
	})

	it("an approved spawn_agent adopts the ask row as the prompts row", () => {
		expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ approved: { toolCallId: "s1", messageTs: 910 } },
			toolStart("s1", "spawn_agent", { task: "t1" }),
			toolStart("s2", "spawn_agent", { task: "t2" }),
			toolEnd("s2", "spawn_agent", { output: { text: "ok", usage: { inputTokens: 1, outputTokens: 1 } } }),
			toolEnd("s1", "spawn_agent", { output: { text: "ok", usage: { inputTokens: 1, outputTokens: 1 } } }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
	})

	it("a denied tool renders nothing at open or close, including the errored close", () => {
		const messages = expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ denied: { toolCallId: "c1", toolName: "fetch_web_content", reason: USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON } },
			toolStart("c1", "fetch_web_content", { requests: [] }),
			toolEnd("c1", "fetch_web_content", { error: USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON }),
			ev({ type: "content_end", contentType: "text", text: "understood" }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
		expect(messages.some((message) => message.say === "tool" || message.say === "error")).toBe(false)
	})

	it("a denied spawn_agent, command, and MCP tool render nothing", () => {
		const messages = expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ denied: { toolCallId: "s1", toolName: "spawn_agent", reason: DEFAULT_TOOL_APPROVAL_DENIAL_REASON } },
			toolStart("s1", "spawn_agent", { task: "t" }),
			toolEnd("s1", "spawn_agent", { error: DEFAULT_TOOL_APPROVAL_DENIAL_REASON }),
			{ denied: { toolCallId: "c2", toolName: "run_commands", reason: DEFAULT_TOOL_APPROVAL_DENIAL_REASON } },
			toolStart("c2", "run_commands", { commands: ["rm"] }),
			toolEnd("c2", "run_commands", { error: DEFAULT_TOOL_APPROVAL_DENIAL_REASON }),
			{ denied: { toolCallId: "c3", toolName: "srv__tool", reason: DEFAULT_TOOL_APPROVAL_DENIAL_REASON } },
			toolStart("c3", "srv__tool", { a: 1 }),
			toolEnd("c3", "srv__tool", { error: DEFAULT_TOOL_APPROVAL_DENIAL_REASON }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
		expect(messages.filter((message) => message.say !== "api_req_started")).toEqual([])
	})

	it("a denial recognized only by its error text keeps the open's row and adds no error row", () => {
		// No decision reached this host (e.g. an SDK-internal denial): v1
		// matches the close's error text; the partial row from the open
		// stays and nothing follows it.
		expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			toolStart("c1", "read_file", { path: "/tmp/x" }),
			toolEnd("c1", "read_file", { error: `{"error":"${DEFAULT_TOOL_APPROVAL_DENIAL_REASON}"}` }),
			toolStart("c2", "run_commands", { commands: ["ls"] }),
			toolEnd("c2", "run_commands", { error: DEFAULT_TOOL_APPROVAL_DENIAL_REASON }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
	})

	it("a decision with no matching tool block leaves the rest of the turn unaffected", () => {
		expectApprovalParity([
			ev({ type: "iteration_start", iteration: 1 }),
			{ approved: { toolCallId: "ghost", messageTs: 950 } },
			toolStart("c1", "read_file", { path: "/tmp/x" }),
			toolEnd("c1", "read_file", { output: "ok" }),
			ev({ type: "done", text: "", reason: "completed", iterations: 1 }),
		])
	})
})
