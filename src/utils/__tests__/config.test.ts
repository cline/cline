import { injectEnv } from "../config"

describe("injectEnv", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Assign a new / reset process.env before each test
		jest.resetModules()
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
				value: "Keep this ${env:API_KEY}",
			},
		}
		const expectedObject = {
			key: "12345",
			url: "https://example.com",
			nested: {
				value: "Keep this 12345",
			},
		}
		const result = await injectEnv(configObject)
		expect(result).toEqual(expectedObject)
	})

	it("should use notFoundValue for missing env variables", async () => {
		const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation()
		process.env.EXISTING_VAR = "exists"
		const configString = "Value: ${env:EXISTING_VAR}, Missing: ${env:MISSING_VAR}"
		const expectedString = "Value: exists, Missing: NOT_FOUND"
		const result = await injectEnv(configString, "NOT_FOUND")
		expect(result).toBe(expectedString)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"[injectEnv] env variable MISSING_VAR referenced but not found in process.env",
		)
		consoleWarnSpy.mockRestore()
	})

	it("should use default empty string for missing env variables if notFoundValue is not provided", async () => {
		const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation()
		const configString = "Missing: ${env:ANOTHER_MISSING}"
		const expectedString = "Missing: "
		const result = await injectEnv(configString)
		expect(result).toBe(expectedString)
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"[injectEnv] env variable ANOTHER_MISSING referenced but not found in process.env",
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
