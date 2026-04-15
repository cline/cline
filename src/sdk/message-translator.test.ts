import type { CoreSessionEvent } from "@clinebot/core"
import type { AgentEvent } from "@clinebot/shared"
import { describe, expect, it } from "vitest"
import { historyItemToSessionFields, MessageTranslatorState, translateSessionEvent } from "./message-translator"

// ---------------------------------------------------------------------------
// MessageTranslatorState
// ---------------------------------------------------------------------------

describe("MessageTranslatorState", () => {
	it("generates unique timestamps", () => {
		const state = new MessageTranslatorState()
		const ts1 = state.nextTs()
		const ts2 = state.nextTs()
		expect(ts2).toBeGreaterThan(ts1)
	})

	it("tracks streaming text timestamps", () => {
		const state = new MessageTranslatorState()
		const ts1 = state.getStreamingTextTs()
		const ts2 = state.getStreamingTextTs()
		// Same ts while streaming
		expect(ts2).toBe(ts1)
	})

	it("clears streaming text and returns the ts", () => {
		const state = new MessageTranslatorState()
		const ts = state.getStreamingTextTs()
		const cleared = state.clearStreamingText()
		expect(cleared).toBe(ts)

		// Next call should get a new ts
		const newTs = state.getStreamingTextTs()
		expect(newTs).toBeGreaterThan(ts)
	})

	it("clearStreamingText without prior get returns a new ts", () => {
		const state = new MessageTranslatorState()
		const ts = state.clearStreamingText()
		expect(typeof ts).toBe("number")
	})

	it("tracks streaming reasoning timestamps", () => {
		const state = new MessageTranslatorState()
		const ts1 = state.getStreamingReasoningTs()
		const ts2 = state.getStreamingReasoningTs()
		expect(ts2).toBe(ts1)

		const cleared = state.clearStreamingReasoning()
		expect(cleared).toBe(ts1)

		const newTs = state.getStreamingReasoningTs()
		expect(newTs).toBeGreaterThan(ts1)
	})

	it("tracks streaming tool timestamps", () => {
		const state = new MessageTranslatorState()
		const ts1 = state.getStreamingToolTs()
		const ts2 = state.getStreamingToolTs()
		expect(ts2).toBe(ts1)

		const cleared = state.clearStreamingTool()
		expect(cleared).toBe(ts1)

		const newTs = state.getStreamingToolTs()
		expect(newTs).toBeGreaterThan(ts1)
	})

	it("reset clears all streaming state", () => {
		const state = new MessageTranslatorState()
		const textTs = state.getStreamingTextTs()
		const reasoningTs = state.getStreamingReasoningTs()
		const toolTs = state.getStreamingToolTs()

		state.reset()

		// After reset, new streaming ts should be different
		const newTextTs = state.getStreamingTextTs()
		const newReasoningTs = state.getStreamingReasoningTs()
		const newToolTs = state.getStreamingToolTs()

		expect(newTextTs).toBeGreaterThan(textTs)
		expect(newReasoningTs).toBeGreaterThan(reasoningTs)
		expect(newToolTs).toBeGreaterThan(toolTs)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — chunk events
// ---------------------------------------------------------------------------

describe("translateSessionEvent — chunk events", () => {
	it("ignores agent stream chunks (raw model output not displayed)", () => {
		// Chunk events contain raw model output which may include JSON,
		// tool call fragments, etc. The structured agent_event system
		// (content_start/update/end) is used for displayable content.
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "chunk",
			payload: {
				sessionId: "session-1",
				stream: "agent",
				chunk: '{"type":"iteration_start",...}',
				ts: Date.now(),
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(0)
		expect(result.sessionEnded).toBe(false)
		expect(result.turnComplete).toBe(false)
	})

	it("ignores stdout/stderr chunks", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "chunk",
			payload: {
				sessionId: "session-1",
				stream: "stdout",
				chunk: "some output",
				ts: Date.now(),
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — agent_event (content_start)
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event content_start", () => {
	it("translates text content_start to partial text message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "text",
					text: "Hello",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("text")
		expect(result.messages[0].text).toBe("Hello")
		expect(result.messages[0].partial).toBe(true)
	})

	it("translates reasoning content_start to partial reasoning message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "reasoning",
					reasoning: "Let me think...",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("reasoning")
		expect(result.messages[0].reasoning).toBe("Let me think...")
		expect(result.messages[0].partial).toBe(true)
	})

	it("translates tool content_start to partial tool message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "read_files",
					toolCallId: "call-1",
					input: { path: "/src/index.ts" },
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("tool")
		expect(result.messages[0].partial).toBe(true)
		// sdkToolToClineSayTool converts "read_files" → "readFile" and
		// the text is JSON.stringify(ClineSayTool)
		expect(result.messages[0].text).toContain("readFile")
		expect(result.messages[0].text).toContain("/src/index.ts")
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — agent_event (content_end)
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event content_end", () => {
	it("translates text content_end to complete text message", () => {
		const state = new MessageTranslatorState()
		// First, start streaming
		const startEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "text",
					text: "Hello",
				} as AgentEvent,
			},
		}
		translateSessionEvent(startEvent, state)

		// Then end it
		const endEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "text",
					text: "Hello world",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(endEvent, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("text")
		expect(result.messages[0].text).toBe("Hello world")
		expect(result.messages[0].partial).toBe(false)
	})

	it("translates tool content_end with error", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName: "execute_command",
					toolCallId: "call-1",
					error: "Command not found",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		// Error produces two messages: the tool message + an error message
		expect(result.messages).toHaveLength(2)
		expect(result.messages[0].say).toBe("tool")
		expect(result.messages[0].partial).toBe(false)
		expect(result.messages[1].say).toBe("error")
		expect(result.messages[1].text).toBe("Command not found")
		expect(result.messages[1].partial).toBe(false)
	})

	it("translates tool content_end with output", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName: "read_files",
					toolCallId: "call-1",
					output: "file contents here",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		// Tool content_end produces a ClineSayTool JSON with the tool name
		expect(result.messages[0].say).toBe("tool")
		expect(result.messages[0].text).toContain("readFile")
		expect(result.messages[0].partial).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — agent_event (done)
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event done", () => {
	it("translates done event to completion_result message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "done",
					reason: "completed",
					text: "Task completed successfully",
					iterations: 1,
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("completion_result")
		expect(result.messages[0].text).toBe("Task completed successfully")
		expect(result.messages[0].partial).toBe(false)
		expect(result.turnComplete).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — agent_event (error)
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event error", () => {
	it("translates error event to error message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: { message: "API rate limit exceeded" },
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("error")
		expect(result.messages[0].text).toBe("API rate limit exceeded")
		expect(result.messages[0].partial).toBe(false)
		expect(result.turnComplete).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — ended event
// ---------------------------------------------------------------------------

describe("translateSessionEvent — ended event", () => {
	it("marks session as ended and turn as complete", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "ended",
			payload: {
				sessionId: "session-1",
				reason: "completed",
				ts: Date.now(),
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(0)
		expect(result.sessionEnded).toBe(true)
		expect(result.turnComplete).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — hook events
// ---------------------------------------------------------------------------

describe("translateSessionEvent — hook events", () => {
	it("translates tool_call hook to hook_status message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "hook",
			payload: {
				sessionId: "session-1",
				hookEventName: "tool_call",
				toolName: "write_to_file",
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("hook_status")
		expect(result.messages[0].text).toContain("write_to_file")
	})

	it("translates tool_result hook to hook_status message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "hook",
			payload: {
				sessionId: "session-1",
				hookEventName: "tool_result",
				toolName: "read_files",
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].text).toContain("completed")
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — status event
// ---------------------------------------------------------------------------

describe("translateSessionEvent — status event", () => {
	it("produces no messages for status events", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "status",
			payload: {
				sessionId: "session-1",
				status: "running",
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(0)
		expect(result.sessionEnded).toBe(false)
		expect(result.turnComplete).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — streaming flow
// ---------------------------------------------------------------------------

describe("translateSessionEvent — full streaming flow", () => {
	it("handles a complete text streaming flow", () => {
		const state = new MessageTranslatorState()

		// 1. Start streaming text
		const startResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_start", contentType: "text", text: "Hello" } as AgentEvent,
				},
			},
			state,
		)
		expect(startResult.messages).toHaveLength(1)
		expect(startResult.messages[0].partial).toBe(true)
		expect(startResult.messages[0].text).toBe("Hello")

		// 2. End streaming text
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_end", contentType: "text", text: "Hello world!" } as AgentEvent,
				},
			},
			state,
		)
		expect(endResult.messages).toHaveLength(1)
		expect(endResult.messages[0].partial).toBe(false)
		expect(endResult.messages[0].text).toBe("Hello world!")

		// 3. Done
		const doneResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "done", reason: "completed", text: "Done", iterations: 1 } as AgentEvent,
				},
			},
			state,
		)
		expect(doneResult.messages).toHaveLength(1)
		expect(doneResult.messages[0].say).toBe("completion_result")
		expect(doneResult.turnComplete).toBe(true)
	})

	it("handles text → tool → text flow", () => {
		const state = new MessageTranslatorState()

		// 1. Text start
		const textStart = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_start", contentType: "text", text: "Let me read that file" } as AgentEvent,
				},
			},
			state,
		)
		expect(textStart.messages[0].say).toBe("text")

		// 2. Text end
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_end", contentType: "text", text: "Let me read that file" } as AgentEvent,
				},
			},
			state,
		)

		// 3. Tool start
		const toolStart = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "call-1",
						input: { path: "/src/main.ts" },
					} as AgentEvent,
				},
			},
			state,
		)
		expect(toolStart.messages[0].say).toBe("tool")
		expect(toolStart.messages[0].partial).toBe(true)

		// 4. Tool end
		const toolEnd = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "call-1",
						output: "file contents",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(toolEnd.messages[0].say).toBe("tool")
		expect(toolEnd.messages[0].partial).toBe(false)

		// 5. Second text start (after tool)
		const text2Start = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_start", contentType: "text", text: "Here's what I found:" } as AgentEvent,
				},
			},
			state,
		)
		expect(text2Start.messages[0].say).toBe("text")
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — notice event
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event notice", () => {
	it("translates notice event to info message", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "notice",
					message: "Retrying API request...",
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("info")
		expect(result.messages[0].text).toBe("Retrying API request...")
		expect(result.messages[0].partial).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — content_update
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event content_update", () => {
	it("skips tool content_update (webview uses content_start partial until content_end)", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_update",
					contentType: "tool",
					toolName: "execute_command",
					toolCallId: "call-1",
					update: "Running npm install...",
				} as AgentEvent,
			},
		}

		// content_update is intentionally not forwarded to the webview —
		// the content_start message with partial=true is sufficient until
		// content_end finalizes it. This avoids flooding the webview.
		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// historyItemToSessionFields
// ---------------------------------------------------------------------------

describe("historyItemToSessionFields", () => {
	it("maps HistoryItem to session fields", () => {
		const result = historyItemToSessionFields({
			id: "task-123",
			task: "Fix the bug",
			ts: 1700000000000,
			tokensIn: 500,
			tokensOut: 250,
			totalCost: 0.05,
			modelId: "claude-sonnet-4-6",
		})

		expect(result.sessionId).toBe("task-123")
		expect(result.prompt).toBe("Fix the bug")
		expect(result.usage.tokensIn).toBe(500)
		expect(result.usage.tokensOut).toBe(250)
		expect(result.usage.totalCost).toBe(0.05)
		expect(result.modelId).toBe("claude-sonnet-4-6")
		expect(result.startedAt).toBe(new Date(1700000000000).toISOString())
	})

	it("handles missing optional fields", () => {
		const result = historyItemToSessionFields({
			id: "task-456",
			task: "Simple task",
			ts: 1700000000000,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		})

		expect(result.sessionId).toBe("task-456")
		expect(result.modelId).toBeUndefined()
	})
})
