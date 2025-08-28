import { parseStackTrace, applySourceMapsToStack, enhanceErrorWithSourceMaps } from "../sourceMapUtils"

// Mock console.debug to avoid cluttering test output
beforeEach(() => {
	vi.spyOn(console, "debug").mockImplementation(() => {})
})

describe("sourceMapUtils", () => {
	describe("parseStackTrace", () => {
		// Note: parseStackTrace is now a compatibility function
		test("should correctly parse a Chrome-style stack trace", async () => {
			const stackTrace = `Error: Test error
    at Function.execute (webpack:///./src/components/App.tsx:123:45)
    at Object.next (webpack:///./node_modules/react/index.js:76:21)
    at eval (webpack:///./src/utils/helpers.ts:89:10)`

			const frames = await parseStackTrace(stackTrace)

			// Verify it still returns an array of frame objects
			expect(frames).toBeInstanceOf(Array)
			expect(frames.length).toBeGreaterThan(0)

			// Check that the first frame has the expected properties
			const firstFrame = frames[0]
			expect(firstFrame).toHaveProperty("functionName")
			expect(firstFrame).toHaveProperty("fileName")
			expect(firstFrame).toHaveProperty("lineNumber")
			expect(firstFrame).toHaveProperty("columnNumber")
			expect(firstFrame).toHaveProperty("source")

			// Verify the first frame has the correct values
			expect(firstFrame.fileName).toBe("webpack:///./src/components/App.tsx")
			expect(firstFrame.lineNumber).toBe(123)
			expect(firstFrame.columnNumber).toBe(45)
		})

		test("should return empty array for empty stack", async () => {
			expect(await parseStackTrace("")).toEqual([])
			expect(await parseStackTrace(undefined as unknown as string)).toEqual([])
		})
	})

	describe("applySourceMapsToStack", () => {
		test("should return original stack when source maps cannot be applied", async () => {
			const stackTrace = `Error: Test error
    at Function.execute (webpack:///./src/components/App.tsx:123:45)`

			const result = await applySourceMapsToStack(stackTrace)

			// For now, we expect it to return the original stack
			// since we haven't implemented actual source map application
			expect(result).toBe(stackTrace)
		})

		test("should handle empty stack", async () => {
			const emptyStack = ""
			const result = await applySourceMapsToStack(emptyStack)
			expect(result).toBe(emptyStack)
		})
	})

	describe("enhanceErrorWithSourceMaps", () => {
		test("should add sourceMappedStack property to error", async () => {
			const error = new Error("Test error")
			error.stack = `Error: Test error
    at Function.execute (webpack:///./src/components/App.tsx:123:45)`

			// Mock the applySourceMapsToStack function
			vi.spyOn(global.console, "error").mockImplementation(() => {})

			const enhancedError = await enhanceErrorWithSourceMaps(error)

			expect(enhancedError).toBe(error) // Should return the same error object
			expect("sourceMappedStack" in enhancedError).toBe(true)
		})

		test("should handle errors without stack", async () => {
			const error = new Error("Test error")
			error.stack = undefined

			const enhancedError = await enhanceErrorWithSourceMaps(error)

			expect(enhancedError).toBe(error)
			expect("sourceMappedStack" in enhancedError).toBe(false)
		})
	})
})
