/**
 * Tests for HookResponse utilities
 */

import { expect } from "chai"
import { describe, it } from "mocha"
import {
	aggregateHookResults,
	createDenyResponse,
	DEFAULT_APPROVE_RESPONSE,
	HookExecutionResult,
	parseHookOutput,
} from "./HookResponse"

describe("HookResponse Utilities", () => {
	describe("parseHookOutput", () => {
		it("should parse JSON approval response", () => {
			const stdout = JSON.stringify({
				approve: true,
				message: "Tool approved",
				additionalContext: "Extra info",
			})
			const result = parseHookOutput(stdout, "", 0)

			expect(result.exitCode).to.equal(0)
			expect(result.response?.approve).to.equal(true)
			expect(result.response?.message).to.equal("Tool approved")
			expect(result.response?.additionalContext).to.equal("Extra info")
		})

		it("should parse JSON denial response", () => {
			const stdout = JSON.stringify({
				approve: false,
				message: "Tool denied for security reasons",
			})
			const result = parseHookOutput(stdout, "", 0)

			expect(result.exitCode).to.equal(0)
			expect(result.response?.approve).to.equal(false)
			expect(result.response?.message).to.equal("Tool denied for security reasons")
		})

		it("should handle non-zero exit code as denial", () => {
			const result = parseHookOutput("", "Error occurred", 1)

			expect(result.exitCode).to.equal(1)
			expect(result.response?.approve).to.equal(false)
			expect(result.response?.message).to.equal("Error occurred")
		})

		it("should handle non-zero exit code with no stderr", () => {
			const result = parseHookOutput("", "", 127)

			expect(result.exitCode).to.equal(127)
			expect(result.response?.approve).to.equal(false)
			expect(result.response?.message).to.equal("Hook denied with exit code 127")
		})

		it("should treat non-JSON stdout with exit 0 as approval", () => {
			const result = parseHookOutput("OK", "", 0)

			expect(result.exitCode).to.equal(0)
			expect(result.response?.approve).to.equal(true)
			expect(result.response).to.deep.equal(DEFAULT_APPROVE_RESPONSE)
		})

		it("should parse JSON with input modifications", () => {
			const stdout = JSON.stringify({
				approve: true,
				modifiedInput: { path: "/modified/path.txt" },
			})
			const result = parseHookOutput(stdout, "", 0)

			expect(result.response?.approve).to.equal(true)
			expect(result.response?.modifiedInput).to.deep.equal({ path: "/modified/path.txt" })
		})

		it("should parse JSON with output modifications", () => {
			const stdout = JSON.stringify({
				approve: true,
				modifiedOutput: { result: "modified output" },
			})
			const result = parseHookOutput(stdout, "", 0)

			expect(result.response?.approve).to.equal(true)
			expect(result.response?.modifiedOutput).to.deep.equal({ result: "modified output" })
		})
	})

	describe("createDenyResponse", () => {
		it("should create a denial response with reason", () => {
			const response = createDenyResponse("Access denied to sensitive file")

			expect(response.approve).to.equal(false)
			expect(response.message).to.equal("Access denied to sensitive file")
		})
	})

	describe("aggregateHookResults", () => {
		it("should approve when all hooks approve", () => {
			const results: HookExecutionResult[] = [
				{ response: { approve: true, message: "Hook 1 OK" }, exitCode: 0 },
				{ response: { approve: true, message: "Hook 2 OK" }, exitCode: 0 },
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(true)
			expect(aggregated.messages).to.deep.equal(["Hook 1 OK", "Hook 2 OK"])
		})

		it("should deny when any hook denies", () => {
			const results: HookExecutionResult[] = [
				{ response: { approve: true, message: "Hook 1 OK" }, exitCode: 0 },
				{ response: { approve: false, message: "Hook 2 denied" }, exitCode: 0 },
				{ response: { approve: true, message: "Hook 3 OK" }, exitCode: 0 },
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(false)
			expect(aggregated.messages).to.deep.equal(["Hook 1 OK", "Hook 2 denied", "Hook 3 OK"])
		})

		it("should deny on hook error", () => {
			const results: HookExecutionResult[] = [
				{ response: { approve: true }, exitCode: 0 },
				{ error: "Failed to execute hook", exitCode: 127 },
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(false)
			expect(aggregated.messages).to.include("Hook error: Failed to execute hook")
		})

		it("should deny on hook timeout", () => {
			const results: HookExecutionResult[] = [{ response: { approve: true }, exitCode: 0 }, { timedOut: true }]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(false)
			expect(aggregated.messages).to.include("Hook timed out")
		})

		it("should merge additional context", () => {
			const results: HookExecutionResult[] = [
				{ response: { approve: true, additionalContext: "Context 1" }, exitCode: 0 },
				{ response: { approve: true, additionalContext: "Context 2" }, exitCode: 0 },
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(true)
			expect(aggregated.additionalContext).to.deep.equal(["Context 1", "Context 2"])
		})

		it("should let later modifications override earlier ones", () => {
			const results: HookExecutionResult[] = [
				{
					response: {
						approve: true,
						modifiedInput: { path: "/first.txt" },
						modifiedOutput: { result: "first" },
					},
					exitCode: 0,
				},
				{
					response: {
						approve: true,
						modifiedInput: { path: "/second.txt" },
					},
					exitCode: 0,
				},
				{
					response: {
						approve: true,
						modifiedOutput: { result: "third" },
					},
					exitCode: 0,
				},
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.approve).to.equal(true)
			expect(aggregated.modifiedInput).to.deep.equal({ path: "/second.txt" })
			expect(aggregated.modifiedOutput).to.deep.equal({ result: "third" })
		})

		it("should handle empty results", () => {
			const aggregated = aggregateHookResults([])

			expect(aggregated.approve).to.equal(true)
			expect(aggregated.messages).to.deep.equal([])
			expect(aggregated.additionalContext).to.be.undefined
		})

		it("should include individual results for debugging", () => {
			const results: HookExecutionResult[] = [
				{ response: { approve: true }, exitCode: 0, executionTime: 100 },
				{ response: { approve: false }, exitCode: 1, executionTime: 200 },
			]

			const aggregated = aggregateHookResults(results)

			expect(aggregated.individualResults).to.deep.equal(results)
			expect(aggregated.individualResults[0].executionTime).to.equal(100)
			expect(aggregated.individualResults[1].executionTime).to.equal(200)
		})
	})
})
