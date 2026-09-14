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
			// Terminal non-recoverable errors emit the not-yet-ported
			// api_req_failed pair in v1 — excluded surface.
			if (events.some((e) => e.type === "error" && e.recoverable !== true)) {
				continue
			}
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
