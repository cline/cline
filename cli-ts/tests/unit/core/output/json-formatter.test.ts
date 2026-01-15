import { expect } from "chai"
import sinon from "sinon"
import { JsonFormatter } from "../../../../src/core/output/json-formatter.js"
import type { ClineMessage, TaskInfo } from "../../../../src/core/output/types.js"

describe("JsonFormatter", () => {
	let formatter: JsonFormatter
	let consoleLogStub: sinon.SinonStub
	let capturedOutput: string[]

	beforeEach(() => {
		formatter = new JsonFormatter()
		capturedOutput = []
		consoleLogStub = sinon.stub(console, "log").callsFake((output: string) => {
			capturedOutput.push(output)
		})
	})

	afterEach(() => {
		sinon.restore()
	})

	function getLastOutput(): Record<string, unknown> {
		const lastOutput = capturedOutput[capturedOutput.length - 1]
		return JSON.parse(lastOutput)
	}

	describe("message", () => {
		it("should output message as valid JSON", () => {
			const msg: ClineMessage = {
				type: "say",
				text: "Hello world",
				ts: 1705344000000,
				say: "text",
			}
			formatter.message(msg)

			const output = getLastOutput()
			expect(output.type).to.equal("message")
			expect(output.data).to.deep.include({
				type: "say",
				text: "Hello world",
				ts: 1705344000000,
				say: "text",
			})
			expect(output.ts).to.be.a("number")
		})

		it("should preserve all message fields", () => {
			const msg: ClineMessage = {
				type: "ask",
				text: "Question?",
				ts: 1705344000000,
				ask: "followup",
				reasoning: "thinking...",
				partial: true,
			}
			formatter.message(msg)

			const output = getLastOutput()
			const data = output.data as ClineMessage
			expect(data.type).to.equal("ask")
			expect(data.ask).to.equal("followup")
			expect(data.reasoning).to.equal("thinking...")
			expect(data.partial).to.be.true
		})
	})

	describe("error", () => {
		it("should output error string as JSON", () => {
			formatter.error("Something went wrong")

			const output = getLastOutput()
			expect(output.type).to.equal("error")
			expect((output.data as Record<string, unknown>).message).to.equal("Something went wrong")
		})

		it("should output error object with stack", () => {
			const err = new Error("Test error")
			formatter.error(err)

			const output = getLastOutput()
			expect(output.type).to.equal("error")
			const data = output.data as Record<string, unknown>
			expect(data.message).to.equal("Test error")
			expect(data.name).to.equal("Error")
			expect(data.stack).to.be.a("string")
		})
	})

	describe("success", () => {
		it("should output success message", () => {
			formatter.success("Operation completed")

			const output = getLastOutput()
			expect(output.type).to.equal("success")
			expect((output.data as Record<string, unknown>).message).to.equal("Operation completed")
		})
	})

	describe("warn", () => {
		it("should output warning message", () => {
			formatter.warn("Be careful")

			const output = getLastOutput()
			expect(output.type).to.equal("warn")
			expect((output.data as Record<string, unknown>).message).to.equal("Be careful")
		})
	})

	describe("info", () => {
		it("should output info message", () => {
			formatter.info("Some information")

			const output = getLastOutput()
			expect(output.type).to.equal("info")
			expect((output.data as Record<string, unknown>).message).to.equal("Some information")
		})
	})

	describe("table", () => {
		it("should output table data with rows and columns", () => {
			const data = [
				{ name: "Alice", age: 30 },
				{ name: "Bob", age: 25 },
			]
			formatter.table(data)

			const output = getLastOutput()
			expect(output.type).to.equal("table")
			const tableData = output.data as { rows: unknown[]; columns: string[] }
			expect(tableData.rows).to.deep.equal(data)
			expect(tableData.columns).to.deep.equal(["name", "age"])
		})

		it("should use custom columns when specified", () => {
			const data = [{ name: "Alice", age: 30, city: "NYC" }]
			formatter.table(data, ["name", "city"])

			const output = getLastOutput()
			const tableData = output.data as { rows: unknown[]; columns: string[] }
			expect(tableData.columns).to.deep.equal(["name", "city"])
		})

		it("should handle empty data", () => {
			formatter.table([])

			const output = getLastOutput()
			const tableData = output.data as { rows: unknown[]; columns: string[] }
			expect(tableData.rows).to.deep.equal([])
			expect(tableData.columns).to.deep.equal([])
		})
	})

	describe("list", () => {
		it("should output items array", () => {
			formatter.list(["item1", "item2", "item3"])

			const output = getLastOutput()
			expect(output.type).to.equal("list")
			expect((output.data as { items: string[] }).items).to.deep.equal(["item1", "item2", "item3"])
		})
	})

	describe("tasks", () => {
		it("should output task list", () => {
			const tasks: TaskInfo[] = [
				{
					id: "task-1",
					ts: 1705344000000,
					task: "Fix the bug",
					completed: true,
					totalTokens: 1000,
					totalCost: 0.05,
				},
			]
			formatter.tasks(tasks)

			const output = getLastOutput()
			expect(output.type).to.equal("tasks")
			expect((output.data as { tasks: TaskInfo[] }).tasks).to.deep.equal(tasks)
		})
	})

	describe("keyValue", () => {
		it("should output key-value object", () => {
			formatter.keyValue({ name: "test", count: 42 })

			const output = getLastOutput()
			expect(output.type).to.equal("keyValue")
			expect(output.data).to.deep.equal({ name: "test", count: 42 })
		})
	})

	describe("raw", () => {
		it("should output raw content wrapped in JSON", () => {
			formatter.raw("raw text here")

			const output = getLastOutput()
			expect(output.type).to.equal("raw")
			expect((output.data as { content: string }).content).to.equal("raw text here")
		})
	})

	describe("JSON validity", () => {
		it("should always output valid JSON lines", () => {
			formatter.message({ type: "say", text: "test", ts: Date.now() })
			formatter.error("error")
			formatter.success("success")
			formatter.table([{ a: 1 }])

			for (const line of capturedOutput) {
				expect(() => JSON.parse(line)).to.not.throw()
			}
		})

		it("should include timestamp in all outputs", () => {
			formatter.message({ type: "say", text: "test", ts: Date.now() })
			formatter.error("error")
			formatter.success("success")

			for (const line of capturedOutput) {
				const parsed = JSON.parse(line)
				expect(parsed.ts).to.be.a("number")
				expect(parsed.ts).to.be.greaterThan(0)
			}
		})
	})
})
