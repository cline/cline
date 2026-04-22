import type { CoreSessionEvent } from "@clinebot/core"
import type { AgentEvent } from "@clinebot/shared"
import type { ClineAskUseMcpServer } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	extractToolOutputText,
	historyItemToSessionFields,
	MessageTranslatorState,
	translateSessionEvent,
} from "./message-translator"

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
					toolName: "read_files",
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

	it("content_end preserves tool input from content_start (S6-24 fix)", () => {
		const state = new MessageTranslatorState()
		const expectedDiff = "------- SEARCH\nconsole.log('world')\n=======\nconsole.log('hello')\n+++++++ REPLACE"

		// 1. content_start with editor tool input
		const startEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-1",
					input: { path: "/src/app.ts", new_text: "console.log('hello')", old_text: "console.log('world')" },
				} as AgentEvent,
			},
		}
		const startResult = translateSessionEvent(startEvent, state)
		expect(startResult.messages).toHaveLength(1)
		const startTool = JSON.parse(startResult.messages[0].text!)
		expect(startTool.tool).toBe("editedExistingFile")
		expect(startTool.path).toBe("/src/app.ts")
		// S6-48: when both old_text and new_text are provided, content is a search/replace diff
		expect(startTool.content).toBe(expectedDiff)

		// 2. content_end — should preserve the input from content_start
		const endEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-1",
				} as AgentEvent,
			},
		}
		const endResult = translateSessionEvent(endEvent, state)
		expect(endResult.messages).toHaveLength(1)
		expect(endResult.messages[0].partial).toBe(false)
		const endTool = JSON.parse(endResult.messages[0].text!)
		// The finalized message should have the same content as the partial
		expect(endTool.tool).toBe("editedExistingFile")
		expect(endTool.path).toBe("/src/app.ts")
		expect(endTool.content).toBe(expectedDiff)
	})

	it("content_end for newFileCreated preserves content from content_start (S6-24)", () => {
		const state = new MessageTranslatorState()

		// content_start with editor tool (no old_text → newFileCreated)
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "editor",
						toolCallId: "c1",
						input: { path: "/new-file.ts", new_text: "export const x = 1" },
					} as AgentEvent,
				},
			},
			state,
		)

		// content_end
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "editor",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)

		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("newFileCreated")
		expect(endTool.path).toBe("/new-file.ts")
		expect(endTool.content).toBe("export const x = 1")
	})

	it("content_end for read_files preserves path from content_start (S6-24)", () => {
		const state = new MessageTranslatorState()

		// content_start
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "c1",
						input: { files: [{ path: "/src/config.ts" }] },
					} as AgentEvent,
				},
			},
			state,
		)

		// content_end (no input)
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)

		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("readFile")
		expect(endTool.path).toBe("/src/config.ts")
	})

	it("content_end for read_files emits one tool message per file when multiple files are read", () => {
		const state = new MessageTranslatorState()

		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "c1",
						input: { files: [{ path: "/src/README.md" }, { path: "/src/package.json" }] },
					} as AgentEvent,
				},
			},
			state,
		)

		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)

		expect(endResult.messages).toHaveLength(2)
		const first = JSON.parse(endResult.messages[0].text!)
		const second = JSON.parse(endResult.messages[1].text!)
		expect(first.tool).toBe("readFile")
		expect(second.tool).toBe("readFile")
		expect(first.path).toBe("/src/README.md")
		expect(second.path).toBe("/src/package.json")
	})

	it("content_end without prior content_start still works (graceful fallback)", () => {
		const state = new MessageTranslatorState()

		// content_end with no prior content_start — stored input is undefined
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "editor",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)

		// Should still produce a message, just with empty fields
		expect(endResult.messages).toHaveLength(1)
		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("newFileCreated") // no old_text → newFileCreated
		expect(endTool.path).toBe("")
	})
})

// ---------------------------------------------------------------------------
// translateSessionEvent — agent_event (done)
// ---------------------------------------------------------------------------

describe("translateSessionEvent — agent_event done", () => {
	it("translates done event to ask completion_result with empty text (no green rectangle)", () => {
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

		// When attempt_completion was NOT called, the done event emits
		// ask:"completion_result" with empty text (renders as InvisibleSpacer,
		// no green rectangle) to enable follow-up input.
		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].ask).toBe("completion_result")
		expect(result.messages[0].text).toBe("")
		expect(result.messages[0].partial).toBe(false)
		expect(result.turnComplete).toBe(true)
	})

	it("suppresses done completion_result when attempt_completion was already seen", () => {
		const state = new MessageTranslatorState()

		// Simulate attempt_completion being called (content_start)
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "attempt_completion",
						input: { result: "All done!" },
					} as AgentEvent,
				},
			},
			state,
		)

		// Simulate content_end for attempt_completion
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "attempt_completion",
					} as AgentEvent,
				},
			},
			state,
		)

		// Now the done event should NOT emit any messages
		const doneResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "done",
						reason: "completed",
						text: "All done!",
						iterations: 1,
					} as AgentEvent,
				},
			},
			state,
		)
		expect(doneResult.messages).toHaveLength(0)
		expect(doneResult.turnComplete).toBe(true)
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

		// 3. Done — without attempt_completion, emits ask:"completion_result"
		// with empty text (no green rectangle, just enables follow-up input)
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
		expect(doneResult.messages[0].ask).toBe("completion_result")
		expect(doneResult.messages[0].text).toBe("")
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

describe("translateSessionEvent — accumulated text streaming (S6-21 fix)", () => {
	it("uses accumulated text for smooth streaming instead of delta", () => {
		const state = new MessageTranslatorState()

		// First chunk: text="Hello ", accumulated="Hello "
		const chunk1 = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "text",
						text: "Hello ",
						accumulated: "Hello ",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(chunk1.messages).toHaveLength(1)
		expect(chunk1.messages[0].text).toBe("Hello ")
		expect(chunk1.messages[0].partial).toBe(true)
		const streamingTs = chunk1.messages[0].ts

		// Second chunk: text="world" (delta), accumulated="Hello world" (full)
		// The message should use accumulated, NOT text (delta)
		const chunk2 = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "text",
						text: "world",
						accumulated: "Hello world",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(chunk2.messages).toHaveLength(1)
		// CRITICAL: Must be "Hello world" (accumulated), NOT "world" (delta)
		// Using delta would cause "flip book" effect in the webview
		expect(chunk2.messages[0].text).toBe("Hello world")
		expect(chunk2.messages[0].partial).toBe(true)
		// Same timestamp — webview updates in-place
		expect(chunk2.messages[0].ts).toBe(streamingTs)

		// Third chunk: more text
		const chunk3 = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "text",
						text: "!",
						accumulated: "Hello world!",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(chunk3.messages).toHaveLength(1)
		expect(chunk3.messages[0].text).toBe("Hello world!")
		expect(chunk3.messages[0].ts).toBe(streamingTs)

		// content_end finalizes
		const end = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "text",
						text: "Hello world!",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(end.messages).toHaveLength(1)
		expect(end.messages[0].text).toBe("Hello world!")
		expect(end.messages[0].partial).toBe(false)
		expect(end.messages[0].ts).toBe(streamingTs)
	})

	it("falls back to text when accumulated is not provided", () => {
		const state = new MessageTranslatorState()

		// Some SDK events may not have accumulated (e.g., first chunk)
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "text",
						text: "Hello",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].text).toBe("Hello")
	})

	it("all streaming chunks share the same timestamp for in-place updates", () => {
		const state = new MessageTranslatorState()
		const timestamps: number[] = []

		for (let i = 0; i < 5; i++) {
			const result = translateSessionEvent(
				{
					type: "agent_event",
					payload: {
						sessionId: "s1",
						event: {
							type: "content_start",
							contentType: "text",
							text: `chunk${i}`,
							accumulated: `accumulated${i}`,
						} as AgentEvent,
					},
				},
				state,
			)
			timestamps.push(result.messages[0].ts)
		}

		// All timestamps should be identical
		expect(new Set(timestamps).size).toBe(1)
	})

	// ---------------------------------------------------------------------------
	// extractToolOutputText
	// ---------------------------------------------------------------------------

	describe("extractToolOutputText", () => {
		it("returns empty string for null/undefined", () => {
			expect(extractToolOutputText(null)).toBe("")
			expect(extractToolOutputText(undefined)).toBe("")
		})

		it("returns string output as-is", () => {
			expect(extractToolOutputText("hello world\nline 2")).toBe("hello world\nline 2")
		})

		it("returns empty string for empty string", () => {
			expect(extractToolOutputText("")).toBe("")
		})

		it("extracts result text from ToolOperationResult array (single command)", () => {
			const output = [{ query: "ls -la", result: "file1\nfile2\nfile3", success: true }]
			expect(extractToolOutputText(output)).toBe("file1\nfile2\nfile3")
		})

		it("extracts result text from ToolOperationResult array (multiple commands)", () => {
			const output = [
				{ query: "echo hello", result: "hello", success: true },
				{ query: "echo world", result: "world", success: true },
			]
			expect(extractToolOutputText(output)).toBe("hello\nworld")
		})

		it("extracts error text from failed ToolOperationResult", () => {
			const output = [{ query: "bad-command", result: "", error: "Command failed: not found", success: false }]
			expect(extractToolOutputText(output)).toBe("Command failed: not found")
		})

		it("extracts mixed success and error results", () => {
			const output = [
				{ query: "echo ok", result: "ok", success: true },
				{ query: "fail", result: "", error: "Command failed: exit 1", success: false },
			]
			expect(extractToolOutputText(output)).toBe("ok\nCommand failed: exit 1")
		})

		it("handles array of plain strings", () => {
			expect(extractToolOutputText(["line 1", "line 2"])).toBe("line 1\nline 2")
		})

		it("falls back to JSON.stringify for unknown structured output", () => {
			expect(extractToolOutputText({ foo: "bar" })).toBe('{"foo":"bar"}')
		})

		it("falls back to JSON.stringify for empty array", () => {
			expect(extractToolOutputText([])).toBe("[]")
		})

		it("skips ToolOperationResult entries with empty result and no error", () => {
			const output = [
				{ query: "noop", result: "", success: true },
				{ query: "echo hi", result: "hi", success: true },
			]
			expect(extractToolOutputText(output)).toBe("hi")
		})
	})

	// ---------------------------------------------------------------------------
	// command content_end — output formatting
	// ---------------------------------------------------------------------------

	describe("translateSessionEvent — command content_end output formatting", () => {
		it("formats ToolOperationResult[] as raw text, not JSON", () => {
			const state = new MessageTranslatorState()
			const startEvent: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "run_commands",
						toolCallId: "c1",
						input: { commands: ["ls -la"] },
					} as AgentEvent,
				},
			}
			translateSessionEvent(startEvent, state)

			const endEvent: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "run_commands",
						toolCallId: "c1",
						output: [{ query: "ls -la", result: "total 42\nfile1\nfile2", success: true }],
					} as AgentEvent,
				},
			}
			const result = translateSessionEvent(endEvent, state)
			expect(result.messages).toHaveLength(1)
			const msg = result.messages[0]
			expect(msg.say).toBe("command")
			expect(msg.text).toContain("ls -la")
			expect(msg.text).toContain("Output:")
			expect(msg.text).toContain("total 42")
			// Should NOT contain JSON artifacts
			expect(msg.text).not.toContain('"query"')
			expect(msg.text).not.toContain('"success"')
		})

		it("formats string output directly", () => {
			const state = new MessageTranslatorState()
			translateSessionEvent(
				{
					type: "agent_event",
					payload: {
						sessionId: "s1",
						event: {
							type: "content_start",
							contentType: "tool",
							toolName: "run_commands",
							toolCallId: "c2",
							input: { commands: ["echo hello"] },
						} as AgentEvent,
					},
				},
				state,
			)

			const result = translateSessionEvent(
				{
					type: "agent_event",
					payload: {
						sessionId: "s1",
						event: {
							type: "content_end",
							contentType: "tool",
							toolName: "run_commands",
							toolCallId: "c2",
							output: "hello\n",
						} as AgentEvent,
					},
				},
				state,
			)

			const msg = result.messages[0]
			expect(msg.text).toContain("echo hello")
			expect(msg.text).toContain("Output:")
			expect(msg.text).toContain("hello")
		})

		it("formats error output", () => {
			const state = new MessageTranslatorState()
			translateSessionEvent(
				{
					type: "agent_event",
					payload: {
						sessionId: "s1",
						event: {
							type: "content_start",
							contentType: "tool",
							toolName: "run_commands",
							toolCallId: "c3",
							input: { commands: ["bad-cmd"] },
						} as AgentEvent,
					},
				},
				state,
			)

			const result = translateSessionEvent(
				{
					type: "agent_event",
					payload: {
						sessionId: "s1",
						event: {
							type: "content_end",
							contentType: "tool",
							toolName: "run_commands",
							toolCallId: "c3",
							error: "command not found",
						} as AgentEvent,
					},
				},
				state,
			)

			const msg = result.messages[0]
			expect(msg.text).toContain("Error: command not found")
		})
	})
})

// ---------------------------------------------------------------------------
// S6-39: fetch_web_content renders URL (SDK input: { requests: [{ url, prompt }] })
// S6-40: skills tool renders skill name (SDK input: { skill: "name" })
// ---------------------------------------------------------------------------

describe("sdkToolToClineSayTool — fetch_web_content and skills (S6-39, S6-40)", () => {
	it("S6-39: fetch_web_content extracts URL from SDK requests array", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "fetch_web_content",
					toolCallId: "c1",
					input: { requests: [{ url: "https://example.com/docs", prompt: "Summarize" }] },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("webFetch")
		expect(tool.path).toBe("https://example.com/docs")
	})

	it("S6-39: content_end preserves URL from content_start", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "fetch_web_content",
						toolCallId: "c1",
						input: { requests: [{ url: "https://example.com", prompt: "Read" }] },
					} as AgentEvent,
				},
			},
			state,
		)
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "fetch_web_content",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)
		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("webFetch")
		expect(endTool.path).toBe("https://example.com")
	})

	it("S6-39: classic web_fetch with flat url field still works", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "web_fetch",
					toolCallId: "c1",
					input: { url: "https://classic.com", prompt: "Read" },
				} as AgentEvent,
			},
		}
		const tool = JSON.parse(translateSessionEvent(event, state).messages[0].text!)
		expect(tool.tool).toBe("webFetch")
		expect(tool.path).toBe("https://classic.com")
	})

	it("S6-39: multiple requests extracts first URL", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "fetch_web_content",
					toolCallId: "c1",
					input: {
						requests: [
							{ url: "https://first.com", prompt: "p1" },
							{ url: "https://second.com", prompt: "p2" },
						],
					},
				} as AgentEvent,
			},
		}
		const tool = JSON.parse(translateSessionEvent(event, state).messages[0].text!)
		expect(tool.path).toBe("https://first.com")
	})

	it("S6-40: skills tool extracts name from SDK 'skill' field", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "skills",
					toolCallId: "c1",
					input: { skill: "commit", args: null },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("useSkill")
		expect(tool.path).toBe("commit")
	})

	it("S6-40: skills content_end preserves skill name from content_start", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "skills",
						toolCallId: "c1",
						input: { skill: "review-pr", args: "123" },
					} as AgentEvent,
				},
			},
			state,
		)
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: { type: "content_end", contentType: "tool", toolName: "skills", toolCallId: "c1" } as AgentEvent,
				},
			},
			state,
		)
		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("useSkill")
		expect(endTool.path).toBe("review-pr")
	})

	it("S6-40: classic use_skill with skill_name field still works", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "use_skill",
					toolCallId: "c1",
					input: { skill_name: "kanban" },
				} as AgentEvent,
			},
		}
		const tool = JSON.parse(translateSessionEvent(event, state).messages[0].text!)
		expect(tool.tool).toBe("useSkill")
		expect(tool.path).toBe("kanban")
	})
})

// ---------------------------------------------------------------------------
// S6-47: search_codebase renders query and path correctly
// ---------------------------------------------------------------------------

describe("sdkToolToClineSayTool — search_codebase (S6-47)", () => {
	it("S6-47: search_codebase with { queries: ['TODO', 'FIXME'] } extracts regex", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: { queries: ["TODO", "FIXME"] },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		expect(tool.regex).toBe("TODO, FIXME")
	})

	it("S6-47: search_codebase with stringified JSON input extracts regex", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: JSON.stringify({ queries: ["TODO"] }),
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		expect(tool.regex).toBe("TODO")
	})

	it("S6-47: search_codebase with bare array input extracts regex", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: ["TODO", "FIXME"],
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		expect(tool.regex).toBe("TODO, FIXME")
	})

	it("S6-47: search_codebase with bare string input extracts regex", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: "TODO",
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		expect(tool.regex).toBe("TODO")
	})

	it("S6-47: search_codebase with { queries: 'single' } (string, not array) extracts regex", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: { queries: "TODO" },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		expect(tool.regex).toBe("TODO")
	})

	it("S6-47: content_end preserves search queries from content_start", () => {
		const state = new MessageTranslatorState()
		// content_start
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "search_codebase",
						toolCallId: "c1",
						input: { queries: ["TODO", "FIXME"] },
					} as AgentEvent,
				},
			},
			state,
		)
		// content_end (no input — S6-24 pattern)
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "search_codebase",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)
		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("searchFiles")
		expect(endTool.regex).toBe("TODO, FIXME")
	})

	it("S6-47: content_end preserves bare array input from content_start", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "search_codebase",
						toolCallId: "c1",
						input: ["searchPattern"],
					} as AgentEvent,
				},
			},
			state,
		)
		const endResult = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "search_codebase",
						toolCallId: "c1",
					} as AgentEvent,
				},
			},
			state,
		)
		const endTool = JSON.parse(endResult.messages[0].text!)
		expect(endTool.tool).toBe("searchFiles")
		expect(endTool.regex).toBe("searchPattern")
	})

	it("S6-47: search_codebase path is undefined when SDK has no path param", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "search_codebase",
					toolCallId: "c1",
					input: { queries: ["TODO"] },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("searchFiles")
		// Path should be undefined since SDK search_codebase has no path parameter
		expect(tool.path).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// S6-48: Editor diff rendering — search/replace format for old_text+new_text
// ---------------------------------------------------------------------------

describe("sdkToolToClineSayTool — editor diff rendering (S6-48)", () => {
	it("S6-48: editor with old_text and new_text builds search/replace diff in content", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-1",
					input: { path: "/src/app.ts", old_text: "console.log('world')", new_text: "console.log('hello')" },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("editedExistingFile")
		expect(tool.path).toBe("/src/app.ts")
		expect(tool.content).toBe("------- SEARCH\nconsole.log('world')\n=======\nconsole.log('hello')\n+++++++ REPLACE")
	})

	it("S6-48: editor with only new_text keeps raw new_text in content", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-2",
					input: { path: "/src/new-file.ts", new_text: "export const x = 1" },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("newFileCreated")
		expect(tool.content).toBe("export const x = 1")
	})

	it("S6-48: editor with old_str/new_str also builds search/replace diff", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-3",
					input: { path: "/src/file.ts", old_str: "return false", new_str: "return true" },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.tool).toBe("editedExistingFile")
		expect(tool.content).toBe("------- SEARCH\nreturn false\n=======\nreturn true\n+++++++ REPLACE")
	})

	it("S6-48: multiline old_text/new_text preserved in search/replace diff", () => {
		const state = new MessageTranslatorState()
		const oldText = "function foo() {\n\treturn 1\n}"
		const newText = "function foo() {\n\treturn 2\n}"
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "editor",
					toolCallId: "call-4",
					input: { path: "/src/file.ts", old_text: oldText, new_text: newText },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		const tool = JSON.parse(result.messages[0].text!)
		expect(tool.content).toBe(`------- SEARCH\n${oldText}\n=======\n${newText}\n+++++++ REPLACE`)
		expect(tool.content).toContain("------- SEARCH")
		expect(tool.content).toContain("+++++++ REPLACE")
	})

	// ---------------------------------------------------------------------------
	// S6-48: apply_patch tool — content populated from SDK input field
	// ---------------------------------------------------------------------------

	describe("sdkToolToClineSayTool — apply_patch content (S6-48)", () => {
		it("S6-48: apply_patch with SDK { input: '...' } populates both content and diff", () => {
			const state = new MessageTranslatorState()
			const patchContent = "*** Begin Patch\n*** Update File: src/file.ts\n@@\n-old\n+new\n*** End Patch"
			const event: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "apply_patch",
						toolCallId: "call-1",
						input: { input: patchContent },
					} as AgentEvent,
				},
			}
			const result = translateSessionEvent(event, state)
			const tool = JSON.parse(result.messages[0].text!)
			expect(tool.tool).toBe("editedExistingFile")
			expect(tool.content).toBe(patchContent)
			expect(tool.diff).toBe(patchContent)
		})

		it("S6-48: apply_patch with classic { patch: '...' } populates both content and diff", () => {
			const state = new MessageTranslatorState()
			const patchContent = "*** Begin Patch\n*** Update File: src/file.ts\n@@\n-old\n+new\n*** End Patch"
			const event: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "apply_patch",
						toolCallId: "call-2",
						input: { patch: patchContent },
					} as AgentEvent,
				},
			}
			const result = translateSessionEvent(event, state)
			const tool = JSON.parse(result.messages[0].text!)
			expect(tool.tool).toBe("editedExistingFile")
			expect(tool.content).toBe(patchContent)
			expect(tool.diff).toBe(patchContent)
		})

		it("S6-48: apply_patch prefers 'patch' field over 'input' field", () => {
			const state = new MessageTranslatorState()
			const event: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "apply_patch",
						toolCallId: "call-3",
						input: { patch: "the-patch-content", input: "the-input-content" },
					} as AgentEvent,
				},
			}
			const result = translateSessionEvent(event, state)
			const tool = JSON.parse(result.messages[0].text!)
			expect(tool.content).toBe("the-patch-content")
			expect(tool.diff).toBe("the-patch-content")
		})
	})
})

// ---------------------------------------------------------------------------
// MCP tool handling — say="use_mcp_server" + say="mcp_server_response"
// ---------------------------------------------------------------------------

describe("MCP tool rendering (serverName__toolName convention)", () => {
	it("content_start for MCP tool emits say='use_mcp_server' with ClineAskUseMcpServer payload", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "s1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "notion__notion-get-users",
					toolCallId: "c1",
					input: { user_id: "self" },
				} as AgentEvent,
			},
		}
		const result = translateSessionEvent(event, state)
		expect(result.messages).toHaveLength(1)
		const msg = result.messages[0]
		expect(msg.type).toBe("say")
		expect(msg.say).toBe("use_mcp_server")
		expect(msg.partial).toBe(true)
		const payload = JSON.parse(msg.text!) as ClineAskUseMcpServer
		expect(payload.type).toBe("use_mcp_tool")
		expect(payload.serverName).toBe("notion")
		expect(payload.toolName).toBe("notion-get-users")
		expect(payload.arguments).toContain('"user_id"')
	})

	it("content_end for MCP tool emits finalized use_mcp_server + mcp_server_response", () => {
		const state = new MessageTranslatorState()
		// content_start to set up state
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "notion__notion-get-users",
						toolCallId: "c1",
						input: { user_id: "self" },
					} as AgentEvent,
				},
			},
			state,
		)
		// content_end with output
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "notion__notion-get-users",
						toolCallId: "c1",
						output: "User: Max (self)",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages).toHaveLength(2)
		expect(result.messages[0].say).toBe("use_mcp_server")
		expect(result.messages[0].partial).toBe(false)
		expect(result.messages[1].say).toBe("mcp_server_response")
		expect(result.messages[1].text).toBe("User: Max (self)")
	})

	it("content_end for MCP tool with error shows error in response", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "github__search-repos",
						toolCallId: "c2",
						input: { query: "cline" },
					} as AgentEvent,
				},
			},
			state,
		)
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "github__search-repos",
						toolCallId: "c2",
						error: "Auth failed",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages).toHaveLength(2)
		expect(result.messages[1].say).toBe("mcp_server_response")
		expect(result.messages[1].text).toBe("Error: Auth failed")
	})

	it("MCP tool with empty input omits arguments", () => {
		const state = new MessageTranslatorState()
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "notion__list-databases",
						toolCallId: "c3",
						input: {},
					} as AgentEvent,
				},
			},
			state,
		)
		const payload = JSON.parse(result.messages[0].text!) as ClineAskUseMcpServer
		expect(payload.serverName).toBe("notion")
		expect(payload.toolName).toBe("list-databases")
		expect(payload.arguments).toBeUndefined()
	})

	it("non-MCP tool (no __ separator) still emits say='tool'", () => {
		const state = new MessageTranslatorState()
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "read_files",
						toolCallId: "c4",
						input: { files: [{ path: "/tmp/test.ts" }] },
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages[0].say).toBe("tool")
	})

	it("tool starting with __ (empty server) is not MCP", () => {
		const state = new MessageTranslatorState()
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "__orphan",
						toolCallId: "c5",
						input: {},
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages[0].say).toBe("tool")
	})

	it("content_end with no output omits mcp_server_response", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolName: "notion__update-page",
						toolCallId: "c6",
						input: { page_id: "123" },
					} as AgentEvent,
				},
			},
			state,
		)
		const result = translateSessionEvent(
			{
				type: "agent_event",
				payload: {
					sessionId: "s1",
					event: {
						type: "content_end",
						contentType: "tool",
						toolName: "notion__update-page",
						toolCallId: "c6",
					} as AgentEvent,
				},
			},
			state,
		)
		expect(result.messages).toHaveLength(1)
		expect(result.messages[0].say).toBe("use_mcp_server")
		expect(result.messages[0].partial).toBe(false)
	})
})
