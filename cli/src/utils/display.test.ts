import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { colorize, formatMessage, formatState, formatTimestamp, Spinner, separator, style, taskHeader } from "./display"

describe("display", () => {
	describe("colorize", () => {
		it("should wrap text with color codes", () => {
			const result = colorize("test", "\x1b[31m")
			expect(result).toBe("\x1b[31mtest\x1b[0m")
		})

		it("should combine multiple color codes", () => {
			const result = colorize("test", "\x1b[1m", "\x1b[31m")
			expect(result).toBe("\x1b[1m\x1b[31mtest\x1b[0m")
		})

		it("should handle empty text", () => {
			const result = colorize("", "\x1b[31m")
			expect(result).toBe("\x1b[31m\x1b[0m")
		})
	})

	describe("style helpers", () => {
		it("should apply bold style", () => {
			const result = style.bold("text")
			expect(result).toContain("text")
			expect(result).toContain("\x1b[1m")
		})

		it("should apply dim style", () => {
			const result = style.dim("text")
			expect(result).toContain("text")
			expect(result).toContain("\x1b[2m")
		})

		it("should apply error style", () => {
			const result = style.error("error message")
			expect(result).toContain("error message")
			expect(result).toContain("\x1b[31m") // red
		})

		it("should apply success style", () => {
			const result = style.success("success")
			expect(result).toContain("success")
			expect(result).toContain("\x1b[32m") // green
		})

		it("should apply info style", () => {
			const result = style.info("info")
			expect(result).toContain("info")
			expect(result).toContain("\x1b[36m") // cyan
		})

		it("should apply warning style", () => {
			const result = style.warning("warning")
			expect(result).toContain("warning")
			expect(result).toContain("\x1b[33m") // yellow
		})
	})

	describe("formatTimestamp", () => {
		it("should format timestamp as HH:MM:SS", () => {
			// Create a known timestamp: Jan 1, 2024 15:30:45 UTC
			const ts = new Date("2024-01-01T15:30:45Z").getTime()
			const result = formatTimestamp(ts)
			// Result depends on local timezone, but should be HH:MM:SS format
			expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
		})

		it("should handle zero timestamp", () => {
			const result = formatTimestamp(0)
			expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
		})
	})

	describe("formatMessage", () => {
		const createMessage = (overrides: Partial<ClineMessage>): ClineMessage =>
			({
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "test message",
				...overrides,
			}) as ClineMessage

		describe("say messages", () => {
			it("should format text message", () => {
				const message = createMessage({ say: "text", text: "Hello world" })
				const result = formatMessage(message)
				expect(result).toContain("Hello world")
			})

			it("should format task message", () => {
				const message = createMessage({ say: "task", text: "New task" })
				const result = formatMessage(message)
				expect(result).toContain("Task:")
				expect(result).toContain("New task")
			})

			it("should format error message", () => {
				const message = createMessage({ say: "error", text: "Something went wrong" })
				const result = formatMessage(message)
				expect(result).toContain("Error:")
				expect(result).toContain("Something went wrong")
			})

			it("should format completion_result message", () => {
				const message = createMessage({ say: "completion_result", text: "Done!" })
				const result = formatMessage(message)
				expect(result).toContain("Completed:")
			})

			it("should format reasoning message", () => {
				const message = createMessage({ say: "reasoning", text: "Let me think..." })
				const result = formatMessage(message)
				expect(result).toContain("Thinking:")
				expect(result).toContain("Let me think...")
			})

			it("should format command message", () => {
				const message = createMessage({ say: "command", text: "npm install" })
				const result = formatMessage(message)
				expect(result).toContain("Command:")
				expect(result).toContain("npm install")
			})

			it("should truncate long command output", () => {
				const longOutput = "x".repeat(600)
				const message = createMessage({ say: "command_output", text: longOutput })
				const result = formatMessage(message)
				expect(result).toContain("Output:")
				expect(result).toContain("...")
				expect(result.length).toBeLessThan(longOutput.length + 100)
			})

			it("should format user_feedback message", () => {
				const message = createMessage({ say: "user_feedback", text: "User said something" })
				const result = formatMessage(message)
				expect(result).toContain("User:")
			})

			it("should format tool message", () => {
				const message = createMessage({ say: "tool", text: "read_file" })
				const result = formatMessage(message)
				expect(result).toContain("Tool:")
			})

			it("should format browser_action message", () => {
				const message = createMessage({ say: "browser_action", text: "click button" })
				const result = formatMessage(message)
				expect(result).toContain("Browser:")
			})

			it("should format api_req_started in verbose mode", () => {
				const message = createMessage({ say: "api_req_started", text: "" })
				const result = formatMessage(message, true)
				expect(result).toContain("API request started")
			})

			it("should format checkpoint_created message", () => {
				const message = createMessage({ say: "checkpoint_created", text: "Saved" })
				const result = formatMessage(message)
				expect(result).toContain("Checkpoint created")
			})

			it("should format info message", () => {
				const message = createMessage({ say: "info", text: "Information" })
				const result = formatMessage(message)
				expect(result).toContain("Information")
			})

			it("should show unknown say types in verbose mode", () => {
				const message = createMessage({ say: "unknown_type" as any, text: "test" })
				const resultNormal = formatMessage(message, false)
				const resultVerbose = formatMessage(message, true)
				expect(resultNormal).toBe("")
				expect(resultVerbose).toContain("[SAY:unknown_type]")
			})
		})

		describe("ask messages", () => {
			it("should format followup question", () => {
				const message = createMessage({
					type: "ask",
					ask: "followup",
					text: JSON.stringify({ question: "What do you want?" }),
				})
				const result = formatMessage(message)
				expect(result).toContain("Question:")
				expect(result).toContain("What do you want?")
			})

			it("should handle non-JSON followup text", () => {
				const message = createMessage({
					type: "ask",
					ask: "followup",
					text: "Plain text question",
				})
				const result = formatMessage(message)
				expect(result).toContain("Plain text question")
			})

			it("should format command ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "command",
					text: "rm -rf /",
				})
				const result = formatMessage(message)
				expect(result).toContain("Execute command?")
				expect(result).toContain("rm -rf /")
			})

			it("should format tool ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "tool",
					text: "write_to_file",
				})
				const result = formatMessage(message)
				expect(result).toContain("Use tool?")
			})

			it("should format completion_result ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "completion_result",
					text: "Task completed successfully",
				})
				const result = formatMessage(message)
				expect(result).toContain("Task completed")
			})

			it("should format api_req_failed ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "api_req_failed",
					text: "Rate limit exceeded",
				})
				const result = formatMessage(message)
				expect(result).toContain("API request failed")
				expect(result).toContain("Rate limit exceeded")
			})

			it("should format resume_task ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "resume_task",
					text: "",
				})
				const result = formatMessage(message)
				expect(result).toContain("Resume task?")
			})

			it("should format browser_action_launch ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "browser_action_launch",
					text: "https://example.com",
				})
				const result = formatMessage(message)
				expect(result).toContain("Launch browser?")
			})

			it("should format use_mcp_server ask", () => {
				const message = createMessage({
					type: "ask",
					ask: "use_mcp_server",
					text: "server-name",
				})
				const result = formatMessage(message)
				expect(result).toContain("Use MCP server?")
			})

			it("should show unknown ask types in verbose mode", () => {
				const message = createMessage({
					type: "ask",
					ask: "unknown_ask" as any,
					text: "test",
				})
				const resultNormal = formatMessage(message, false)
				const resultVerbose = formatMessage(message, true)
				expect(resultNormal).toBe("")
				expect(resultVerbose).toContain("[ASK:unknown_ask]")
			})
		})
	})

	describe("separator", () => {
		it("should create a separator with default char and width", () => {
			const result = separator()
			expect(result).toContain("─".repeat(60))
		})

		it("should use custom character", () => {
			const result = separator("=", 10)
			expect(result).toContain("=".repeat(10))
		})

		it("should use custom width", () => {
			const result = separator("-", 20)
			expect(result).toContain("-".repeat(20))
		})
	})

	describe("taskHeader", () => {
		it("should format task header with ID", () => {
			const result = taskHeader("task-123")
			expect(result).toContain("Task: task-123")
		})

		it("should include task description", () => {
			const result = taskHeader("task-123", "Build a website")
			expect(result).toContain("task-123")
			expect(result).toContain("Build a website")
		})

		it("should truncate long task descriptions", () => {
			const longTask = "x".repeat(100)
			const result = taskHeader("task-123", longTask)
			expect(result).toContain("...")
		})
	})

	describe("formatState", () => {
		it("should format state with messages", () => {
			const state: Partial<ExtensionState> = {
				clineMessages: [{ ts: Date.now(), type: "say", say: "text", text: "Hello" } as ClineMessage],
			}
			const result = formatState(state as ExtensionState)
			expect(result).toContain("Hello")
		})

		it("should include task header when currentTaskItem exists", () => {
			const state: Partial<ExtensionState> = {
				currentTaskItem: {
					id: "task-1",
					ts: Date.now(),
					task: "Do something",
					tokensIn: 10,
					tokensOut: 20,
					modelId: "gpt-4",
					totalCost: 0.0025,
				},
				clineMessages: [],
			}
			const result = formatState(state as ExtensionState)
			expect(result).toContain("Task: task-1")
		})

		it("should handle empty messages array", () => {
			const state: Partial<ExtensionState> = {
				clineMessages: [],
			}
			const result = formatState(state as ExtensionState)
			expect(result).toBe("")
		})

		it("should handle undefined messages", () => {
			const state: Partial<ExtensionState> = {}
			const result = formatState(state as ExtensionState)
			expect(result).toBe("")
		})
	})

	describe("Spinner", () => {
		let spinner: Spinner
		let writeSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			spinner = new Spinner()
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
			vi.useFakeTimers()
		})

		afterEach(() => {
			spinner.stop()
			vi.restoreAllMocks()
			vi.useRealTimers()
		})

		it("should start spinning with message", () => {
			spinner.start("Loading...")
			vi.advanceTimersByTime(80)
			expect(writeSpy).toHaveBeenCalled()
			const calls = writeSpy.mock.calls.map((c: any[]) => c[0])
			expect(calls.some((c: any) => typeof c === "string" && c.includes("Loading..."))).toBe(true)
		})

		it("should update message", () => {
			spinner.start("Initial")
			spinner.update("Updated")
			vi.advanceTimersByTime(80)
			const calls = writeSpy.mock.calls.map((c: any[]) => c[0])
			expect(calls.some((c: any) => typeof c === "string" && c.includes("Updated"))).toBe(true)
		})

		it("should stop with final message", () => {
			spinner.start("Loading...")
			spinner.stop("Done!")
			const calls = writeSpy.mock.calls.map((c: any[]) => c[0])
			expect(calls.some((c: any) => typeof c === "string" && c.includes("Done!"))).toBe(true)
		})

		it("should clear line when stopped without message", () => {
			spinner.start("Loading...")
			spinner.stop()
			expect(writeSpy).toHaveBeenCalled()
		})

		it("should show failure message", () => {
			spinner.start("Loading...")
			spinner.fail("Failed!")
			const calls = writeSpy.mock.calls.map((c: any[]) => c[0])
			expect(calls.some((c: any) => typeof c === "string" && c.includes("Failed!"))).toBe(true)
		})
	})
})
