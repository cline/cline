import { vitest, describe, it, expect, beforeEach, afterAll } from "vitest"
import { injectEnv, injectVariables } from "../config"


describe("injectEnv", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Assign a new / reset process.env before each test
		vitest.resetModules()
		process.env = { ...originalEnv }
	})

	afterAll(() => {
		// Restore original process.env after all tests
		process.env = originalEnv
	})

	it("should replace env variables in a string", async () => {
		process.env.TEST_VAR = "testValue"
		const configString = "Hello ${env:TEST_VAR}"
		const expectedString = "Hello testValue"
		const result = await injectEnv(configString)
		expect(result).toBe(expectedString)
	})

	it("should replace env variables in an object", async () => {
		process.env.API_KEY = "12345"
		process.env.ENDPOINT = "https://example.com"
		const configObject = {
			key: "${env:API_KEY}",
			url: "${env:ENDPOINT}",
			nested: {
				string: "Keep this ${env:API_KEY}",
				number: 123,
				boolean: true,
				stringArr: ["${env:API_KEY}", "${env:ENDPOINT}"],
				numberArr: [123, 456],
				booleanArr: [true, false],
			},
			deeply: {
				nested: {
					string: "Keep this ${env:API_KEY}",
					number: 123,
					boolean: true,
					stringArr: ["${env:API_KEY}", "${env:ENDPOINT}"],
					numberArr: [123, 456],
					booleanArr: [true, false],
				},
			},
		}
		const expectedObject = {
			key: "12345",
			url: "https://example.com",
			nested: {
				string: "Keep this 12345",
				number: 123,
				boolean: true,
				stringArr: ["12345", "https://example.com"],
				numberArr: [123, 456],
				booleanArr: [true, false],
			},
			deeply: {
				nested: {
					string: "Keep this 12345",
					number: 123,
					boolean: true,
					stringArr: ["12345", "https://example.com"],
					numberArr: [123, 456],
					booleanArr: [true, false],
				},
			},
		}
		const result = await injectEnv(configObject)
		expect(result).toEqual(expectedObject)
	})

	it("should use notFoundValue for missing env variables", async () => {
		const consoleWarnSpy = vitest.spyOn(console, "warn").mockImplementation(() => {})
		process.env.EXISTING_VAR = "exists"
		const configString = "Value: ${env:EXISTING_VAR}, Missing: ${env:MISSING_VAR}"
		const expectedString = "Value: exists, Missing: NOT_FOUND"
		const result = await injectEnv(configString, "NOT_FOUND")
		expect(result).toBe(expectedString)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			`[injectVariables] variable "MISSING_VAR" referenced but not found in "env"`,
		)
		consoleWarnSpy.mockRestore()
	})

	it("should use default empty string for missing env variables if notFoundValue is not provided", async () => {
		const consoleWarnSpy = vitest.spyOn(console, "warn").mockImplementation(() => {})
		const configString = "Missing: ${env:ANOTHER_MISSING}"
		const expectedString = "Missing: "
		const result = await injectEnv(configString)
		expect(result).toBe(expectedString)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			`[injectVariables] variable "ANOTHER_MISSING" referenced but not found in "env"`,
		)
		consoleWarnSpy.mockRestore()
	})

	it("should handle strings without env variables", async () => {
		const configString = "Just a regular string"
		const result = await injectEnv(configString)
		expect(result).toBe(configString)
	})

	it("should handle objects without env variables", async () => {
		const configObject = { key: "value", number: 123 }
		const result = await injectEnv(configObject)
		expect(result).toEqual(configObject)
	})

	it("should not mutate the original object", async () => {
		process.env.MUTATE_TEST = "mutated"
		const originalObject = { value: "${env:MUTATE_TEST}" }
		const copyOfOriginal = { ...originalObject } // Shallow copy for comparison
		await injectEnv(originalObject)
		expect(originalObject).toEqual(copyOfOriginal) // Check if the original object remains unchanged
	})

	it("should handle empty string input", async () => {
		const result = await injectEnv("")
		expect(result).toBe("")
	})

	it("should handle empty object input", async () => {
		const result = await injectEnv({})
		expect(result).toEqual({})
	})
})

describe("injectVariables", () => {
	it("should replace singular variable", async () => {
		const result = await injectVariables("Hello ${v}", { v: "Hola" })
		expect(result).toEqual("Hello Hola")
	})

	it("should handle undefined singular variable input", async () => {
		const result = await injectVariables("Hello ${v}", { v: undefined })
		expect(result).toEqual("Hello ${v}")
	})

	it("should handle empty string singular variable input", async () => {
		const result = await injectVariables("Hello ${v}", { v: "" })
		expect(result).toEqual("Hello ")
	})

	// Variable maps are already tested by `injectEnv` tests above.
})
