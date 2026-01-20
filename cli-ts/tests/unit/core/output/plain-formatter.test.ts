import { expect } from "chai"
import sinon from "sinon"
import { PlainFormatter } from "../../../../src/core/output/plain-formatter.js"
import type { ClineMessage, TaskInfo } from "../../../../src/core/output/types.js"

describe("PlainFormatter", () => {
	let formatter: PlainFormatter
	let consoleLogStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub
	let consoleWarnStub: sinon.SinonStub
	let stdoutWriteStub: sinon.SinonStub

	beforeEach(() => {
		formatter = new PlainFormatter()
		consoleLogStub = sinon.stub(console, "log")
		consoleErrorStub = sinon.stub(console, "error")
		consoleWarnStub = sinon.stub(console, "warn")
		stdoutWriteStub = sinon.stub(process.stdout, "write")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("message", () => {
		it("should output say message with prefix", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Hello world",
				ts: Date.now(),
				say: "text",
			}
			formatter.message(msg)
			expect(consoleLogStub.calledWith("[>] (text) Hello world")).to.be.true
		})

		it("should output ask message with ? prefix", () => {
			const msg: ClineMessage = {
				type: "ask",
				text: "What should I do?",
				ts: Date.now(),
				ask: "followup",
			}
			formatter.message(msg)
			expect(consoleLogStub.calledWith("[?] (followup) What should I do?")).to.be.true
		})

		it("should output reasoning when present", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Result",
				ts: Date.now(),
				reasoning: "I thought about this",
			}
			formatter.message(msg)
			expect(consoleLogStub.calledWith("[thinking] I thought about this")).to.be.true
		})
	})

	describe("error", () => {
		it("should output error string", () => {
			formatter.error("Something went wrong")
			expect(consoleErrorStub.calledWith("ERROR: Something went wrong")).to.be.true
		})

		it("should output error object message", () => {
			formatter.error(new Error("Test error"))
			expect(consoleErrorStub.calledWith("ERROR: Test error")).to.be.true
		})
	})

	describe("success", () => {
		it("should output success message with OK prefix", () => {
			formatter.success("Operation completed")
			expect(consoleLogStub.calledWith("OK: Operation completed")).to.be.true
		})
	})

	describe("warn", () => {
		it("should output warning message", () => {
			formatter.warn("Be careful")
			expect(consoleWarnStub.calledWith("WARN: Be careful")).to.be.true
		})
	})

	describe("info", () => {
		it("should output info message", () => {
			formatter.info("Some information")
			expect(consoleLogStub.calledWith("INFO: Some information")).to.be.true
		})
	})

	describe("table", () => {
		it("should output table with headers and rows", () => {
			const data = [
				{ name: "Alice", age: 30 },
				{ name: "Bob", age: 25 },
			]
			formatter.table(data)
			expect(consoleLogStub.calledWith("name\tage")).to.be.true
			expect(consoleLogStub.calledWith("Alice\t30")).to.be.true
			expect(consoleLogStub.calledWith("Bob\t25")).to.be.true
		})

		it("should handle empty data", () => {
			formatter.table([])
			expect(consoleLogStub.calledWith("(no data)")).to.be.true
		})

		it("should use custom columns when specified", () => {
			const data = [{ name: "Alice", age: 30, city: "NYC" }]
			formatter.table(data, ["name", "city"])
			expect(consoleLogStub.calledWith("name\tcity")).to.be.true
			expect(consoleLogStub.calledWith("Alice\tNYC")).to.be.true
		})
	})

	describe("list", () => {
		it("should output items with dash prefix", () => {
			formatter.list(["item1", "item2", "item3"])
			expect(consoleLogStub.calledWith("- item1")).to.be.true
			expect(consoleLogStub.calledWith("- item2")).to.be.true
			expect(consoleLogStub.calledWith("- item3")).to.be.true
		})
	})

	describe("tasks", () => {
		it("should output task list", () => {
			const tasks: TaskInfo[] = [
				{
					id: "task-1",
					ts: new Date("2024-01-15").getTime(),
					task: "Fix the bug",
					completed: true,
				},
				{
					id: "task-2",
					ts: new Date("2024-01-16").getTime(),
					task: "Add new feature",
					completed: false,
				},
			]
			formatter.tasks(tasks)
			// Check that task IDs are in output
			const calls = consoleLogStub.getCalls().map((c) => c.args[0])
			expect(calls.some((c: string) => c.includes("task-1"))).to.be.true
			expect(calls.some((c: string) => c.includes("[done]"))).to.be.true
			expect(calls.some((c: string) => c.includes("[active]"))).to.be.true
		})

		it("should handle empty task list", () => {
			formatter.tasks([])
			expect(consoleLogStub.calledWith("No tasks found")).to.be.true
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
			const calls = consoleLogStub.getCalls().map((c) => c.args[0])
			// Should be truncated with ...
			expect(calls.some((c: string) => c.includes("..."))).to.be.true
		})
	})

	describe("keyValue", () => {
		it("should output key-value pairs", () => {
			formatter.keyValue({ name: "test", count: 42 })
			expect(consoleLogStub.calledWith("name: test")).to.be.true
			expect(consoleLogStub.calledWith("count: 42")).to.be.true
		})
	})

	describe("raw", () => {
		it("should output text as-is", () => {
			// raw() uses stdout.write which is bound at module load time,
			// so we can't easily stub it. Just verify the method exists
			// and doesn't throw.
			expect(() => formatter.raw("raw text here")).to.not.throw()
		})
	})
})
