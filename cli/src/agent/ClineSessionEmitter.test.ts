/**
 * Tests for ClineSessionEmitter - Typed EventEmitter for per-session ACP events.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineSessionEmitter } from "./ClineSessionEmitter.js"
import type { SessionUpdatePayload } from "./types.js"

describe("ClineSessionEmitter", () => {
	let emitter: ClineSessionEmitter

	beforeEach(() => {
		emitter = new ClineSessionEmitter()
	})

	describe("on/emit", () => {
		it("should emit and receive agent_message_chunk events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello, world!" },
			}

			emitter.on("agent_message_chunk", listener)
			emitter.emit("agent_message_chunk", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive agent_thought_chunk events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"agent_thought_chunk"> = {
				content: { type: "text", text: "Thinking..." },
			}

			emitter.on("agent_thought_chunk", listener)
			emitter.emit("agent_thought_chunk", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive tool_call events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"tool_call"> = {
				toolCallId: "test-tool-call-id",
				title: "Test Tool Call",
				status: "in_progress",
			}

			emitter.on("tool_call", listener)
			emitter.emit("tool_call", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive tool_call_update events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"tool_call_update"> = {
				toolCallId: "test-tool-call-id",
				status: "completed",
				rawOutput: { result: "success" },
			}

			emitter.on("tool_call_update", listener)
			emitter.emit("tool_call_update", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive available_commands_update events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"available_commands_update"> = {
				availableCommands: [{ name: "test", description: "Test command" }],
			}

			emitter.on("available_commands_update", listener)
			emitter.emit("available_commands_update", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive current_mode_update events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"current_mode_update"> = {
				currentModeId: "act",
			}

			emitter.on("current_mode_update", listener)
			emitter.emit("current_mode_update", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive plan events", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"plan"> = {
				entries: [{ content: "Step 1", status: "pending", priority: "high" }],
			}

			emitter.on("plan", listener)
			emitter.emit("plan", payload)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(payload)
		})

		it("should emit and receive error events", () => {
			const listener = vi.fn()
			const error = new Error("Test error")

			emitter.on("error", listener)
			emitter.emit("error", error)

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(error)
		})
	})

	describe("multiple listeners", () => {
		it("should support multiple listeners for the same event", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.on("agent_message_chunk", listener1)
			emitter.on("agent_message_chunk", listener2)
			emitter.emit("agent_message_chunk", payload)

			expect(listener1).toHaveBeenCalledTimes(1)
			expect(listener2).toHaveBeenCalledTimes(1)
		})

		it("should call listeners in order of registration", () => {
			const order: number[] = []
			const listener1 = vi.fn(() => order.push(1))
			const listener2 = vi.fn(() => order.push(2))
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.on("agent_message_chunk", listener1)
			emitter.on("agent_message_chunk", listener2)
			emitter.emit("agent_message_chunk", payload)

			expect(order).toEqual([1, 2])
		})
	})

	describe("off", () => {
		it("should remove a specific listener", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.on("agent_message_chunk", listener)
			emitter.off("agent_message_chunk", listener)
			emitter.emit("agent_message_chunk", payload)

			expect(listener).not.toHaveBeenCalled()
		})

		it("should only remove the specified listener", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.on("agent_message_chunk", listener1)
			emitter.on("agent_message_chunk", listener2)
			emitter.off("agent_message_chunk", listener1)
			emitter.emit("agent_message_chunk", payload)

			expect(listener1).not.toHaveBeenCalled()
			expect(listener2).toHaveBeenCalledTimes(1)
		})
	})

	describe("once", () => {
		it("should only call the listener once", () => {
			const listener = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.once("agent_message_chunk", listener)
			emitter.emit("agent_message_chunk", payload)
			emitter.emit("agent_message_chunk", payload)

			expect(listener).toHaveBeenCalledTimes(1)
		})
	})

	describe("removeAllListeners", () => {
		it("should remove all listeners for a specific event", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()
			const payload: SessionUpdatePayload<"agent_message_chunk"> = {
				content: { type: "text", text: "Hello" },
			}

			emitter.on("agent_message_chunk", listener1)
			emitter.on("agent_message_chunk", listener2)
			emitter.removeAllListeners("agent_message_chunk")
			emitter.emit("agent_message_chunk", payload)

			expect(listener1).not.toHaveBeenCalled()
			expect(listener2).not.toHaveBeenCalled()
		})

		it("should remove all listeners when no event is specified", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			emitter.on("agent_message_chunk", listener1)
			emitter.on("tool_call", listener2)
			emitter.removeAllListeners()
			emitter.emit("agent_message_chunk", { content: { type: "text", text: "Hello" } })
			emitter.emit("tool_call", { toolCallId: "test", title: "Test" })

			expect(listener1).not.toHaveBeenCalled()
			expect(listener2).not.toHaveBeenCalled()
		})
	})

	describe("listenerCount", () => {
		it("should return the correct number of listeners", () => {
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			expect(emitter.listenerCount("agent_message_chunk")).toBe(0)

			emitter.on("agent_message_chunk", listener1)
			expect(emitter.listenerCount("agent_message_chunk")).toBe(1)

			emitter.on("agent_message_chunk", listener2)
			expect(emitter.listenerCount("agent_message_chunk")).toBe(2)

			emitter.off("agent_message_chunk", listener1)
			expect(emitter.listenerCount("agent_message_chunk")).toBe(1)
		})
	})

	describe("chaining", () => {
		it("should support method chaining", () => {
			const listener = vi.fn()

			const result = emitter.on("agent_message_chunk", listener).on("error", vi.fn()).off("error", vi.fn())

			expect(result).toBe(emitter)
		})
	})

	describe("emit return value", () => {
		it("should return true when there are listeners", () => {
			emitter.on("agent_message_chunk", vi.fn())
			const result = emitter.emit("agent_message_chunk", { content: { type: "text", text: "Hello" } })
			expect(result).toBe(true)
		})

		it("should return false when there are no listeners", () => {
			const result = emitter.emit("agent_message_chunk", { content: { type: "text", text: "Hello" } })
			expect(result).toBe(false)
		})
	})
})
