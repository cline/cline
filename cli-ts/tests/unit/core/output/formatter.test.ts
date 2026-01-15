import { expect } from "chai"
import {
	createFormatter,
	createFormatterFromOption,
	getDefaultFormat,
	isValidFormat,
	parseOutputFormat,
} from "../../../../src/core/output/index.js"
import { JsonFormatter } from "../../../../src/core/output/json-formatter.js"
import { PlainFormatter } from "../../../../src/core/output/plain-formatter.js"
import { RichFormatter } from "../../../../src/core/output/rich-formatter.js"

describe("Output Formatter Factory", () => {
	describe("getDefaultFormat", () => {
		let originalIsTTY: boolean | undefined

		beforeEach(() => {
			originalIsTTY = process.stdout.isTTY
		})

		afterEach(() => {
			// Restore original value
			Object.defineProperty(process.stdout, "isTTY", {
				value: originalIsTTY,
				writable: true,
			})
		})

		it("should return 'rich' when stdout is a TTY", () => {
			Object.defineProperty(process.stdout, "isTTY", {
				value: true,
				writable: true,
			})
			expect(getDefaultFormat()).to.equal("rich")
		})

		it("should return 'plain' when stdout is not a TTY", () => {
			Object.defineProperty(process.stdout, "isTTY", {
				value: false,
				writable: true,
			})
			expect(getDefaultFormat()).to.equal("plain")
		})
	})

	describe("isValidFormat", () => {
		it("should return true for 'rich'", () => {
			expect(isValidFormat("rich")).to.be.true
		})

		it("should return true for 'json'", () => {
			expect(isValidFormat("json")).to.be.true
		})

		it("should return true for 'plain'", () => {
			expect(isValidFormat("plain")).to.be.true
		})

		it("should return false for invalid formats", () => {
			expect(isValidFormat("invalid")).to.be.false
			expect(isValidFormat("")).to.be.false
			expect(isValidFormat("RICH")).to.be.false
		})
	})

	describe("parseOutputFormat", () => {
		it("should return the format when valid", () => {
			expect(parseOutputFormat("rich")).to.equal("rich")
			expect(parseOutputFormat("json")).to.equal("json")
			expect(parseOutputFormat("plain")).to.equal("plain")
		})

		it("should return default format when undefined", () => {
			const result = parseOutputFormat(undefined)
			expect(["rich", "plain"]).to.include(result)
		})

		it("should throw error for invalid format", () => {
			expect(() => parseOutputFormat("invalid")).to.throw("Invalid output format: invalid")
		})
	})

	describe("createFormatter", () => {
		it("should create RichFormatter for 'rich'", () => {
			const formatter = createFormatter("rich")
			expect(formatter).to.be.instanceOf(RichFormatter)
		})

		it("should create JsonFormatter for 'json'", () => {
			const formatter = createFormatter("json")
			expect(formatter).to.be.instanceOf(JsonFormatter)
		})

		it("should create PlainFormatter for 'plain'", () => {
			const formatter = createFormatter("plain")
			expect(formatter).to.be.instanceOf(PlainFormatter)
		})
	})

	describe("createFormatterFromOption", () => {
		it("should create formatter from string option", () => {
			const formatter = createFormatterFromOption("json")
			expect(formatter).to.be.instanceOf(JsonFormatter)
		})

		it("should use default format when undefined", () => {
			const formatter = createFormatterFromOption(undefined)
			// Should be either Rich or Plain depending on TTY
			expect(formatter).to.satisfy((f: unknown) => f instanceof RichFormatter || f instanceof PlainFormatter)
		})
	})
})
