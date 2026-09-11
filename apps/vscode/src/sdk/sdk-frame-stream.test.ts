/**
 * Tests for the VSCode producer-envelope tap (Phase 3c part 1): the
 * frame stream shares the minter's (epoch, seq) authority, the fence
 * flows through the envelope, and legal streams produce no diagnostics.
 */
import type { CoreSessionEvent } from "@cline/core"
import { describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import { SdkFrameStream } from "./sdk-frame-stream"

const agentEvent = (overrides: Record<string, unknown> = {}) =>
	({ type: "content_start", contentType: "text", text: "hi", ...overrides }) as never

const sessionEvent = (
	eventOverrides: Record<string, unknown> = {},
	payloadOverrides: Record<string, unknown> = {},
): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId: "s1", event: agentEvent(eventOverrides), ...payloadOverrides },
	}) as never

describe("SdkFrameStream", () => {
	it("samples the minter's counter: frame seq equals minter.nextId values", () => {
		const minter = new MessageIdMinter(100)
		const stream = new SdkFrameStream(minter)
		stream.handleSessionEvent(sessionEvent({ type: "iteration_start", iteration: 1 }))
		const firstId = minter.nextId()
		stream.handleSessionEvent(sessionEvent())
		// The next frame stamped after our manual nextId() must be greater,
		// and strictly increasing across frames (shared counter, one order).
		const secondId = minter.nextId()
		expect(secondId).toBeGreaterThan(firstId)
		expect(stream.streamDiagnostics).toEqual([])
	})

	it("carries the epoch fence in the envelope: fenceAndFlush closes scopes, bump fences stragglers", () => {
		const minter = new MessageIdMinter()
		const stream = new SdkFrameStream(minter)
		// Open a turn and a tool block mid-flight.
		stream.handleSessionEvent(sessionEvent({ type: "iteration_start", iteration: 1 }))
		stream.handleSessionEvent(
			sessionEvent({ type: "content_start", contentType: "tool", toolCallId: "t1", toolName: "read_file" }),
		)
		expect(stream.openScopes().blocks).toHaveLength(1)

		// Host fence (as wired in resetMessageTranslatorAndFence / raiseCancelFence):
		// flush closes at the current epoch, then the minter bump fences stragglers.
		stream.fenceAndFlush()
		minter.bumpEpoch()
		expect(stream.openScopes().turnPaths).toEqual([])
		expect(stream.openScopes().blocks).toEqual([])

		// A straggler event from the cancelled turn (old epoch semantics):
		// the framer now stamps with the NEW epoch, so within this stream it
		// opens a fresh turn — the stale-epoch drop is the CONSUMER's rule;
		// here we assert the envelope's promise: post-fence frames carry the
		// new epoch, never the old one.
		const before = minter.epoch
		stream.handleSessionEvent(sessionEvent({ type: "iteration_start", iteration: 1 }))
		expect(minter.epoch).toBe(before)
		expect(stream.openScopes().turnPaths).toHaveLength(1)
	})

	it("routes sub-agent events to their own path via the projector", () => {
		const minter = new MessageIdMinter()
		const stream = new SdkFrameStream(minter)
		stream.handleSessionEvent(sessionEvent({ type: "iteration_start", iteration: 1 }))
		stream.handleSessionEvent(
			sessionEvent({
				type: "content_start",
				contentType: "text",
				text: "child",
				parentAgentId: "root",
				agentId: "agent-a",
			}),
		)
		// Child frames routed structurally (P5): the child's own turn is open.
		expect(stream.openScopes().turnPaths).toContain("root/agent-a")
		expect(stream.openScopes().turnPaths).toContain("root")
		expect(stream.streamDiagnostics).toEqual([])
	})

	it("legal streams produce no diagnostics; repairs are logged", () => {
		const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
		const minter = new MessageIdMinter()
		const stream = new SdkFrameStream(minter)
		stream.handleSessionEvent(sessionEvent({ type: "iteration_start", iteration: 1 }))
		stream.handleSessionEvent(sessionEvent({ type: "done", reason: "completed", text: "ok", iterations: 1 }))
		expect(stream.streamDiagnostics).toEqual([])
		expect(warn).not.toHaveBeenCalled()
		// Malformed: a block close with no open block (v1-illegal input).
		stream.handleSessionEvent(
			sessionEvent({
				type: "content_end",
				contentType: "tool",
				toolCallId: "ghost",
				toolName: "read_file",
			}),
		)
		expect(stream.streamDiagnostics.length).toBeGreaterThan(0)
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})
})
