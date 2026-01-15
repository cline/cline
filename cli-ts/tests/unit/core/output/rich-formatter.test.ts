import { expect } from "chai"
import sinon from "sinon"
import { RichFormatter } from "../../../../src/core/output/rich-formatter.js"
import type { ClineMessage, TaskInfo } from "../../../../src/core/output/types.js"

describe("RichFormatter", () => {
	let formatter: RichFormatter
	let consoleLogStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub
	let consoleWarnStub: sinon.SinonStub
	let capturedOutput: string[]

	beforeEach(() => {
		formatter = new RichFormatter()
		capturedOutput = []
		consoleLogStub = sinon.stub(console, "log").callsFake((...args: unknown[]) => {
			capturedOutput.push(args.join(" "))
		})
		consoleErrorStub = sinon.stub(console, "error").callsFake((...args: unknown[]) => {
			capturedOutput.push(args.join(" "))
		})
		consoleWarnStub = sinon.stub(console, "warn").callsFake((...args: unknown[]) => {
			capturedOutput.push(args.join(" "))
		})
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("message", () => {
		it("should output say message", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Hello world",
				ts: Date.now(),
				say: "text",
			}
			formatter.message(msg)
			expect(consoleLogStub.called).to.be.true
			// Check that text appears in output
			const output = capturedOutput.join("\n")
			expect(output).to.include("Hello world")
		})

		it("should output ask message with question indicator", () => {
			const msg: ClineMessage = {
				type: "ask",
				text: "What should I do?",
				ts: Date.now(),
				ask: "followup",
			}
			formatter.message(msg)
			expect(consoleLogStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("What should I do?")
		})

		it("should output reasoning when present", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Result",
				ts: Date.now(),
				reasoning: "I thought about this",
			}
			formatter.message(msg)
			const output = capturedOutput.join("\n")
			expect(output).to.include("I thought about this")
		})

		it("should indicate streaming for partial messages", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Partial content",
				ts: Date.now(),
				partial: true,
			}
			formatter.message(msg)
			const output = capturedOutput.join("\n")
			expect(output).to.include("streaming")
		})

		it("should handle error message type", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "An error occurred",
				ts: Date.now(),
				say: "error",
			}
			formatter.message(msg)
			expect(consoleLogStub.called).to.be.true
		})

		it("should handle completion_result message type", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Task completed",
				ts: Date.now(),
				say: "completion_result",
			}
			formatter.message(msg)
			expect(consoleLogStub.called).to.be.true
		})
	})

	describe("error", () => {
		it("should output error string", () => {
			formatter.error("Something went wrong")
			expect(consoleErrorStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("Something went wrong")
		})

		it("should output error object with stack trace", () => {
			const err = new Error("Test error")
			formatter.error(err)
			expect(consoleErrorStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("Test error")
		})
	})

	describe("success", () => {
		it("should output success message with checkmark", () => {
			formatter.success("Operation completed")
			expect(consoleLogStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("Operation completed")
		})
	})

	describe("warn", () => {
		it("should output warning message", () => {
			formatter.warn("Be careful")
			expect(consoleWarnStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("Be careful")
		})
	})

	describe("info", () => {
		it("should output info message", () => {
			formatter.info("Some information")
			expect(consoleLogStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("Some information")
		})
	})

	describe("table", () => {
		it("should output formatted table with headers", () => {
			const data = [
				{ name: "Alice", age: 30 },
				{ name: "Bob", age: 25 },
			]
			formatter.table(data)
			expect(consoleLogStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("name")
			expect(output).to.include("age")
			expect(output).to.include("Alice")
			expect(output).to.include("Bob")
		})

		it("should handle empty data", () => {
			formatter.table([])
			const output = capturedOutput.join("\n")
			expect(output).to.include("no data")
		})

		it("should use custom columns when specified", () => {
			const data = [{ name: "Alice", age: 30, city: "NYC" }]
			formatter.table(data, ["name", "city"])
			const output = capturedOutput.join("\n")
			expect(output).to.include("name")
			expect(output).to.include("city")
		})
	})

	describe("list", () => {
		it("should output items with bullets", () => {
			formatter.list(["item1", "item2", "item3"])
			expect(consoleLogStub.called).to.be.true
			const output = capturedOutput.join("\n")
			expect(output).to.include("item1")
			expect(output).to.include("item2")
			expect(output).to.include("item3")
		})
	})

	describe("tasks", () => {
		it("should output formatted task list", () => {
			const tasks: TaskInfo[] = [
				{
					id: "task-1",
					ts: new Date("2024-01-15").getTime(),
					task: "Fix the bug",
					completed: true,
					totalTokens: 1000,
					totalCost: 0.05,
				},
				{
					id: "task-2",
					ts: new Date("2024-01-16").getTime(),
					task: "Add new feature",
					completed: false,
				},
			]
			formatter.tasks(tasks)
			const output = capturedOutput.join("\n")
			expect(output).to.include("task-1")
			expect(output).to.include("task-2")
			expect(output).to.include("Fix the bug")
			expect(output).to.include("done")
			expect(output).to.include("active")
		})

		it("should handle empty task list", () => {
			formatter.tasks([])
			const output = capturedOutput.join("\n")
			expect(output).to.include("No tasks found")
		})

		it("should show token and cost info when available", () => {
			const tasks: TaskInfo[] = [
				{
					id: "task-1",
					ts: Date.now(),
					task: "Test task",
					totalTokens: 5000,
					totalCost: 0.25,
				},
			]
			formatter.tasks(tasks)
			const output = capturedOutput.join("\n")
			expect(output).to.include("5,000")
			expect(output).to.include("0.25")
		})

		it("should truncate long task descriptions", () => {
			const longTask = "A".repeat(100)
			const tasks: TaskInfo[] = [
				{
					id: "task-1",
					ts: Date.now(),
					task: longTask,
				},
			]
			formatter.tasks(tasks)
			const output = capturedOutput.join("\n")
			expect(output).to.include("...")
		})
	})

	describe("keyValue", () => {
		it("should output aligned key-value pairs", () => {
			formatter.keyValue({ name: "test", count: 42 })
			const output = capturedOutput.join("\n")
			expect(output).to.include("name")
			expect(output).to.include("test")
			expect(output).to.include("count")
			expect(output).to.include("42")
		})
	})

	describe("raw", () => {
		it("should output text without formatting", () => {
			formatter.raw("raw text here")
			expect(consoleLogStub.calledWith("raw text here")).to.be.true
		})
	})
})
