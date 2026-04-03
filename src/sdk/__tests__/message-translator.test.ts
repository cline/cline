import { describe, expect, it, beforeEach } from "vitest"
import {
	MessageTranslator,
	type AgentEvent,
	type AgentContentStartEvent,
	type AgentContentEndEvent,
	type AgentContentUpdateEvent,
	type AgentIterationStartEvent,
	type AgentIterationEndEvent,
	type AgentUsageEvent,
	type AgentDoneEvent,
	type AgentErrorEvent,
	type AgentNoticeEvent,
} from "../message-translator"
import type { ClineApiReqInfo, ClineAskQuestion, ClineSayTool } from "@shared/ExtensionMessage"

describe("MessageTranslator", () => {
	let translator: MessageTranslator

	beforeEach(() => {
		translator = new MessageTranslator()
	})

	// -----------------------------------------------------------------------
	// iteration_start → api_req_started
	// -----------------------------------------------------------------------

	describe("iteration_start", () => {
		it("creates an api_req_started ClineMessage", () => {
			const event: AgentIterationStartEvent = {
				type: "iteration_start",
				iteration: 1,
			}

			const update = translator.processEvent(event)
			const messages = translator.getMessages()

			expect(messages).toHaveLength(1)
			expect(messages[0].type).toBe("say")
			expect(messages[0].say).toBe("api_req_started")
			expect(update.added).toEqual([0])
			expect(update.modified).toEqual([])

			const reqInfo = JSON.parse(messages[0].text!) as ClineApiReqInfo
			expect(reqInfo.tokensIn).toBe(0)
			expect(reqInfo.tokensOut).toBe(0)
			expect(reqInfo.cost).toBe(0)
		})

		it("tracks iteration number", () => {
			translator.processEvent({ type: "iteration_start", iteration: 3 })
			expect(translator.getCurrentIteration()).toBe(3)
		})

		it("finalizes in-progress text from previous iteration", () => {
			// Start iteration 1
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			// Start streaming text
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello",
			} as AgentContentStartEvent)

			expect(translator.getMessages()[1].partial).toBe(true)

			// Start iteration 2 — should finalize text
			const update = translator.processEvent({
				type: "iteration_start",
				iteration: 2,
			})

			// text message at index 1 should be finalized
			expect(translator.getMessages()[1].partial).toBe(false)
			expect(translator.getMessages()[1].text).toBe("Hello")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (text) → streaming text ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (text)", () => {
		it("creates a new streaming text message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			const update = translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2) // api_req_started + text
			expect(messages[1].type).toBe("say")
			expect(messages[1].say).toBe("text")
			expect(messages[1].text).toBe("Hello")
			expect(messages[1].partial).toBe(true)
			expect(update.added).toEqual([1])
		})

		it("accumulates text across multiple content_start events", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello",
			} as AgentContentStartEvent)

			const update = translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: " world",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2) // still only 2 messages
			expect(messages[1].text).toBe("Hello world")
			expect(messages[1].partial).toBe(true)
			expect(update.modified).toEqual([1])
			expect(update.added).toEqual([])
		})

		it("handles empty text deltas gracefully", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].text).toBe("")
			expect(messages[1].partial).toBe(true)
		})

		it("handles undefined text field", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].text).toBe("")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (reasoning) → streaming reasoning ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (reasoning)", () => {
		it("creates a new streaming reasoning message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			const update = translator.processEvent({
				type: "content_start",
				contentType: "reasoning",
				reasoning: "Let me think...",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].type).toBe("say")
			expect(messages[1].say).toBe("reasoning")
			expect(messages[1].text).toBe("Let me think...")
			expect(messages[1].partial).toBe(true)
			expect(update.added).toEqual([1])
		})

		it("accumulates reasoning across multiple events", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "reasoning",
				reasoning: "First, ",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_start",
				contentType: "reasoning",
				reasoning: "then next.",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages[1].text).toBe("First, then next.")
			expect(messages[1].partial).toBe(true)
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: read_files) → tool ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (tool: read_files)", () => {
		it("creates a tool say message with readFile format", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			const update = translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_1",
				input: { path: "/src/index.ts" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			// api_req_started + tool
			expect(messages).toHaveLength(2)
			expect(messages[1].type).toBe("say")
			expect(messages[1].say).toBe("tool")

			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("readFile")
			expect(toolInfo.path).toBe("/src/index.ts")
			expect(update.added).toContain(1)
		})

		it("finalizes streaming text before tool", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "I will read...",
			} as AgentContentStartEvent)

			// Text should be partial
			expect(translator.getMessages()[1].partial).toBe(true)

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_1",
				input: { path: "/foo.ts" },
			} as AgentContentStartEvent)

			// Text should now be finalized
			expect(translator.getMessages()[1].partial).toBe(false)
			expect(translator.getMessages()[1].text).toBe("I will read...")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: run_commands) → command ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (tool: run_commands)", () => {
		it("creates a command say message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_2",
				input: { command: "npm test" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].type).toBe("say")
			expect(messages[1].say).toBe("command")
			expect(messages[1].text).toBe("npm test")
		})

		it("handles missing command field", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_2",
				input: { commands: ["ls", "pwd"] },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages[1].say).toBe("command")
			// Falls back to JSON stringify
			expect(messages[1].text).toContain("ls")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: ask_question) → ask followup ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (tool: ask_question)", () => {
		it("creates an ask followup message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "ask_question",
				toolCallId: "tc_3",
				input: { question: "What is your name?", options: ["Alice", "Bob"] },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].type).toBe("ask")
			expect(messages[1].ask).toBe("followup")

			const askData = JSON.parse(messages[1].text!) as ClineAskQuestion
			expect(askData.question).toBe("What is your name?")
			expect(askData.options).toEqual(["Alice", "Bob"])
		})

		it("also recognizes ask_followup_question", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "ask_followup_question",
				toolCallId: "tc_4",
				input: { question: "Continue?" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages[1].type).toBe("ask")
			expect(messages[1].ask).toBe("followup")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: editor) → tool ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (tool: editor)", () => {
		it("creates an editedExistingFile tool message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "editor",
				toolCallId: "tc_5",
				input: { path: "/src/app.ts", diff: "+line1\n-line2" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("editedExistingFile")
			expect(toolInfo.path).toBe("/src/app.ts")
			expect(toolInfo.diff).toBe("+line1\n-line2")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: apply_patch) → tool ClineMessage
	// -----------------------------------------------------------------------

	describe("content_start (tool: apply_patch)", () => {
		it("creates an editedExistingFile tool message with patch", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "apply_patch",
				toolCallId: "tc_6",
				input: { path: "/src/app.ts", patch: "--- a\n+++ b\n@@ ...\n+new line" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("editedExistingFile")
			expect(toolInfo.diff).toBe("--- a\n+++ b\n@@ ...\n+new line")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: fetch_web_content) → webFetch/webSearch
	// -----------------------------------------------------------------------

	describe("content_start (tool: fetch_web_content)", () => {
		it("creates a webFetch tool for URLs", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "fetch_web_content",
				toolCallId: "tc_7",
				input: { url: "https://example.com" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("webFetch")
			expect(toolInfo.path).toBe("https://example.com")
		})

		it("creates a webSearch tool for non-URLs", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "fetch_web_content",
				toolCallId: "tc_8",
				input: { query: "typescript best practices" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("webSearch")
			expect(toolInfo.content).toBe("typescript best practices")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (tool: skills) → useSkill tool
	// -----------------------------------------------------------------------

	describe("content_start (tool: skills)", () => {
		it("creates a useSkill tool message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "skills",
				toolCallId: "tc_9",
				input: { skill: "create-pull-request" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("useSkill")
			expect(toolInfo.path).toBe("create-pull-request")
		})
	})

	// -----------------------------------------------------------------------
	// content_start (unknown/MCP tool) → mcp_server_request_started
	// -----------------------------------------------------------------------

	describe("content_start (unknown/MCP tool)", () => {
		it("creates an mcp_server_request_started message for unknown tools", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "my_custom_mcp_tool",
				toolCallId: "tc_10",
				input: { arg1: "value1" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages[1].say).toBe("mcp_server_request_started")
			const parsed = JSON.parse(messages[1].text!)
			expect(parsed.tool).toBe("my_custom_mcp_tool")
		})
	})

	// -----------------------------------------------------------------------
	// content_end (text) → finalized text ClineMessage
	// -----------------------------------------------------------------------

	describe("content_end (text)", () => {
		it("finalizes a streaming text message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello world",
			} as AgentContentStartEvent)

			expect(translator.getMessages()[1].partial).toBe(true)

			const update = translator.processEvent({
				type: "content_end",
				contentType: "text",
				text: "Hello world",
			} as AgentContentEndEvent)

			expect(translator.getMessages()[1].partial).toBe(false)
			expect(translator.getMessages()[1].text).toBe("Hello world")
			expect(update.modified).toContain(1)
		})

		it("is a no-op if no text was streaming", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			const update = translator.processEvent({
				type: "content_end",
				contentType: "text",
			} as AgentContentEndEvent)

			expect(update.added).toEqual([])
			expect(update.modified).toEqual([])
		})
	})

	// -----------------------------------------------------------------------
	// content_end (tool with output) → command_output ClineMessage
	// -----------------------------------------------------------------------

	describe("content_end (tool: run_commands with output)", () => {
		it("creates a command_output message with commandCompleted", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_cmd",
				input: { command: "echo hello" },
			} as AgentContentStartEvent)

			const update = translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_cmd",
				output: "hello\n",
			} as AgentContentEndEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("command_output")
			expect(lastMsg.text).toBe("hello\n")
			expect(lastMsg.commandCompleted).toBe(true)
			expect(update.added.length).toBeGreaterThan(0)
		})
	})

	// -----------------------------------------------------------------------
	// content_end (tool with error) → error ClineMessage
	// -----------------------------------------------------------------------

	describe("content_end (tool with error)", () => {
		it("creates an error message for failed tool", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_err",
				input: { path: "/nonexistent" },
			} as AgentContentStartEvent)

			translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_err",
				error: "File not found",
			} as AgentContentEndEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error")
			expect(lastMsg.text).toContain("File not found")
		})

		it("creates error for command tool failure", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_cmd_err",
				input: { command: "false" },
			} as AgentContentStartEvent)

			translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_cmd_err",
				error: "Exit code 1",
			} as AgentContentEndEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("command_output")
			expect(lastMsg.text).toContain("Error: Exit code 1")
			expect(lastMsg.commandCompleted).toBe(true)
		})
	})

	// -----------------------------------------------------------------------
	// content_end (MCP tool success) → mcp_server_response
	// -----------------------------------------------------------------------

	describe("content_end (MCP tool success)", () => {
		it("creates an mcp_server_response for unknown tool completion", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "mcp_weather",
				toolCallId: "tc_mcp",
				input: { city: "Tokyo" },
			} as AgentContentStartEvent)

			translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "mcp_weather",
				toolCallId: "tc_mcp",
				output: { temperature: 22, unit: "celsius" },
			} as AgentContentEndEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("mcp_server_response")
			expect(lastMsg.text).toContain("22")
		})
	})

	// -----------------------------------------------------------------------
	// content_update (tool) → command_output for commands
	// -----------------------------------------------------------------------

	describe("content_update (tool)", () => {
		it("appends command_output for run_commands updates", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_upd",
				input: { command: "npm install" },
			} as AgentContentStartEvent)

			const update = translator.processEvent({
				type: "content_update",
				contentType: "tool",
				toolName: "run_commands",
				toolCallId: "tc_upd",
				update: "Installing dependencies...",
			} as AgentContentUpdateEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("command_output")
			expect(lastMsg.text).toBe("Installing dependencies...")
			expect(lastMsg.partial).toBe(true)
			expect(update.added.length).toBe(1)
		})

		it("is a no-op for unknown tool call IDs", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			const update = translator.processEvent({
				type: "content_update",
				contentType: "tool",
				toolCallId: "nonexistent",
				update: "something",
			} as AgentContentUpdateEvent)

			expect(update.added).toEqual([])
			expect(update.modified).toEqual([])
		})
	})

	// -----------------------------------------------------------------------
	// usage → api_req_finished (updates api_req_started)
	// -----------------------------------------------------------------------

	describe("usage", () => {
		it("updates api_req_started with token counts and cost", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			const update = translator.processEvent({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 10,
				cacheWriteTokens: 5,
				cost: 0.001,
				totalInputTokens: 100,
				totalOutputTokens: 50,
				totalCacheReadTokens: 10,
				totalCacheWriteTokens: 5,
				totalCost: 0.001,
			} as AgentUsageEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(1)
			expect(update.modified).toContain(0)

			const reqInfo = JSON.parse(messages[0].text!) as ClineApiReqInfo
			expect(reqInfo.tokensIn).toBe(100)
			expect(reqInfo.tokensOut).toBe(50)
			expect(reqInfo.cacheReads).toBe(10)
			expect(reqInfo.cacheWrites).toBe(5)
			expect(reqInfo.cost).toBe(0.001)
		})

		it("is a no-op if no api_req_started exists", () => {
			const update = translator.processEvent({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				totalInputTokens: 100,
				totalOutputTokens: 50,
			} as AgentUsageEvent)

			expect(update.added).toEqual([])
			expect(update.modified).toEqual([])
		})
	})

	// -----------------------------------------------------------------------
	// done → completion_result ClineMessage
	// -----------------------------------------------------------------------

	describe("done", () => {
		it("creates completion_result for completed reason", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Done!",
			} as AgentContentStartEvent)

			const update = translator.processEvent({
				type: "done",
				reason: "completed",
				text: "Task completed successfully.",
				iterations: 1,
			} as AgentDoneEvent)

			const messages = translator.getMessages()
			// api_req_started + text (finalized) + completion_result
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("completion_result")
			expect(lastMsg.text).toBe("Task completed successfully.")
			expect(update.added.length).toBe(1)

			// Text should be finalized
			expect(messages[1].partial).toBe(false)
		})

		it("creates completion_result for aborted reason", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "done",
				reason: "aborted",
				text: "",
				iterations: 1,
			} as AgentDoneEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("completion_result")
			expect(lastMsg.text).toBe("Task was aborted.")
		})

		it("creates error message for error reason", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "done",
				reason: "error",
				text: "Fatal error occurred.",
				iterations: 2,
			} as AgentDoneEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error")
			expect(lastMsg.text).toBe("Fatal error occurred.")
		})

		it("creates error for max_iterations reason", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "done",
				reason: "max_iterations",
				text: "",
				iterations: 25,
			} as AgentDoneEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error")
			expect(lastMsg.text).toContain("25")
		})

		it("creates error for mistake_limit reason", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "done",
				reason: "mistake_limit",
				text: "",
				iterations: 5,
			} as AgentDoneEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error")
			expect(lastMsg.text).toContain("mistake")
		})
	})

	// -----------------------------------------------------------------------
	// error → error or error_retry ClineMessage
	// -----------------------------------------------------------------------

	describe("error", () => {
		it("creates error_retry for recoverable errors", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			const update = translator.processEvent({
				type: "error",
				error: new Error("Rate limited"),
				recoverable: true,
				iteration: 1,
			} as AgentErrorEvent)

			const messages = translator.getMessages()
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error_retry")
			expect(lastMsg.text).toBe("Rate limited")
			expect(update.added.length).toBe(1)
		})

		it("creates error and updates api_req_started for non-recoverable errors", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			const update = translator.processEvent({
				type: "error",
				error: new Error("Connection failed"),
				recoverable: false,
				iteration: 1,
			} as AgentErrorEvent)

			const messages = translator.getMessages()
			// api_req_started (modified) + error (added)
			const lastMsg = messages[messages.length - 1]
			expect(lastMsg.say).toBe("error")
			expect(lastMsg.text).toBe("Connection failed")
			expect(update.modified).toContain(0) // api_req_started updated

			// api_req_started should have cancelReason
			const reqInfo = JSON.parse(messages[0].text!) as ClineApiReqInfo
			expect(reqInfo.cancelReason).toBe("streaming_failed")
			expect(reqInfo.streamingFailedMessage).toBe("Connection failed")
		})
	})

	// -----------------------------------------------------------------------
	// notice → info or error_retry ClineMessage
	// -----------------------------------------------------------------------

	describe("notice", () => {
		it("creates error_retry for api_error reason", () => {
			translator.processEvent({
				type: "notice",
				noticeType: "recovery",
				message: "Retrying API call...",
				reason: "api_error",
			} as AgentNoticeEvent)

			const messages = translator.getMessages()
			expect(messages[0].say).toBe("error_retry")
			expect(messages[0].text).toBe("Retrying API call...")
		})

		it("creates info for other reasons", () => {
			translator.processEvent({
				type: "notice",
				noticeType: "recovery",
				message: "Tool call failed, trying again",
				reason: "tool_execution_failed",
			} as AgentNoticeEvent)

			const messages = translator.getMessages()
			expect(messages[0].say).toBe("info")
			expect(messages[0].text).toBe("Tool call failed, trying again")
		})
	})

	// -----------------------------------------------------------------------
	// Multiple iterations accumulate correctly
	// -----------------------------------------------------------------------

	describe("multiple iterations", () => {
		it("accumulates messages across iterations", () => {
			// Iteration 1: text + tool
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Let me read the file.",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_end",
				contentType: "text",
			} as AgentContentEndEvent)
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_1",
				input: { path: "/foo.ts" },
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_1",
			} as AgentContentEndEvent)
			translator.processEvent({
				type: "usage",
				inputTokens: 50,
				outputTokens: 20,
				totalInputTokens: 50,
				totalOutputTokens: 20,
				totalCost: 0.0005,
			} as AgentUsageEvent)
			translator.processEvent({
				type: "iteration_end",
				iteration: 1,
				hadToolCalls: true,
				toolCallCount: 1,
			} as AgentIterationEndEvent)

			// Iteration 2: more text + done
			translator.processEvent({ type: "iteration_start", iteration: 2 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "The file contains...",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_end",
				contentType: "text",
			} as AgentContentEndEvent)
			translator.processEvent({
				type: "usage",
				inputTokens: 80,
				outputTokens: 30,
				totalInputTokens: 130,
				totalOutputTokens: 50,
				totalCost: 0.001,
			} as AgentUsageEvent)
			translator.processEvent({
				type: "done",
				reason: "completed",
				text: "Done.",
				iterations: 2,
			} as AgentDoneEvent)

			const messages = translator.getMessages()

			// Expected messages:
			// 0: api_req_started (iteration 1)
			// 1: text "Let me read the file." (finalized)
			// 2: tool readFile
			// 3: api_req_started (iteration 2)
			// 4: text "The file contains..." (finalized)
			// 5: completion_result
			expect(messages.length).toBe(6)

			expect(messages[0].say).toBe("api_req_started")
			expect(messages[1].say).toBe("text")
			expect(messages[1].partial).toBe(false)
			expect(messages[2].say).toBe("tool")
			expect(messages[3].say).toBe("api_req_started")
			expect(messages[4].say).toBe("text")
			expect(messages[4].partial).toBe(false)
			expect(messages[5].say).toBe("completion_result")

			// Check token accumulation on second api_req_started
			const reqInfo2 = JSON.parse(messages[3].text!) as ClineApiReqInfo
			expect(reqInfo2.tokensIn).toBe(130)
			expect(reqInfo2.tokensOut).toBe(50)
			expect(reqInfo2.cost).toBe(0.001)
		})
	})

	// -----------------------------------------------------------------------
	// reset clears state
	// -----------------------------------------------------------------------

	describe("reset", () => {
		it("clears all messages and state", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello",
			} as AgentContentStartEvent)

			expect(translator.getMessages()).toHaveLength(2)
			expect(translator.getCurrentIteration()).toBe(1)

			translator.reset()

			expect(translator.getMessages()).toHaveLength(0)
			expect(translator.getCurrentIteration()).toBe(0)
		})

		it("allows fresh event processing after reset", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Old message",
			} as AgentContentStartEvent)

			translator.reset()

			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "New message",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(2)
			expect(messages[1].text).toBe("New message")
		})
	})

	// -----------------------------------------------------------------------
	// search_codebase tool mapping
	// -----------------------------------------------------------------------

	describe("content_start (tool: search_codebase)", () => {
		it("creates a searchFiles tool message", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "search_codebase",
				toolCallId: "tc_search",
				input: { path: "/src", regex: "TODO", file_pattern: "*.ts" },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("searchFiles")
			expect(toolInfo.path).toBe("/src")
			expect(toolInfo.regex).toBe("TODO")
			expect(toolInfo.filePattern).toBe("*.ts")
		})
	})

	// -----------------------------------------------------------------------
	// iteration_end
	// -----------------------------------------------------------------------

	describe("iteration_end", () => {
		it("finalizes in-progress streaming", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Thinking...",
			} as AgentContentStartEvent)

			expect(translator.getMessages()[1].partial).toBe(true)

			const update = translator.processEvent({
				type: "iteration_end",
				iteration: 1,
				hadToolCalls: false,
				toolCallCount: 0,
			} as AgentIterationEndEvent)

			expect(translator.getMessages()[1].partial).toBe(false)
			expect(update.modified).toContain(1)
		})
	})

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("handles events before any iteration", () => {
			// Text event without iteration_start should still work
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hello",
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			expect(messages).toHaveLength(1)
			expect(messages[0].say).toBe("text")
		})

		it("handles tool end without matching start", () => {
			const update = translator.processEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "nonexistent",
			} as AgentContentEndEvent)

			expect(update.added).toEqual([])
			expect(update.modified).toEqual([])
		})

		it("handles multiple text+reasoning interleaved in one iteration", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })

			// Reasoning first
			translator.processEvent({
				type: "content_start",
				contentType: "reasoning",
				reasoning: "Hmm...",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_end",
				contentType: "reasoning",
			} as AgentContentEndEvent)

			// Then text
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Here's what I think.",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "content_end",
				contentType: "text",
			} as AgentContentEndEvent)

			const messages = translator.getMessages()
			// api_req_started + reasoning + text
			expect(messages).toHaveLength(3)
			expect(messages[1].say).toBe("reasoning")
			expect(messages[1].partial).toBe(false)
			expect(messages[2].say).toBe("text")
			expect(messages[2].partial).toBe(false)
		})

		it("all messages have timestamps", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "text",
				text: "Hi",
			} as AgentContentStartEvent)
			translator.processEvent({
				type: "done",
				reason: "completed",
				text: "Done",
				iterations: 1,
			} as AgentDoneEvent)

			for (const msg of translator.getMessages()) {
				expect(msg.ts).toBeTypeOf("number")
				expect(msg.ts).toBeGreaterThan(0)
			}
		})

		it("handles read_files with paths array", () => {
			translator.processEvent({ type: "iteration_start", iteration: 1 })
			translator.processEvent({
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				toolCallId: "tc_multi",
				input: { paths: ["/a.ts", "/b.ts"] },
			} as AgentContentStartEvent)

			const messages = translator.getMessages()
			const toolInfo = JSON.parse(messages[1].text!) as ClineSayTool
			expect(toolInfo.tool).toBe("readFile")
			expect(toolInfo.path).toBe("/a.ts") // First path
		})
	})
})
