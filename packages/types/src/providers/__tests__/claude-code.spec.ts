import { convertModelNameForVertex, getClaudeCodeModelId } from "../claude-code.js"

describe("convertModelNameForVertex", () => {
	test("should convert hyphen-date format to @date format", () => {
		expect(convertModelNameForVertex("claude-sonnet-4-20250514")).toBe("claude-sonnet-4@20250514")
		expect(convertModelNameForVertex("claude-opus-4-20250514")).toBe("claude-opus-4@20250514")
		expect(convertModelNameForVertex("claude-3-7-sonnet-20250219")).toBe("claude-3-7-sonnet@20250219")
		expect(convertModelNameForVertex("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet@20241022")
		expect(convertModelNameForVertex("claude-3-5-haiku-20241022")).toBe("claude-3-5-haiku@20241022")
	})

	test("should not modify models without date pattern", () => {
		expect(convertModelNameForVertex("some-other-model")).toBe("some-other-model")
		expect(convertModelNameForVertex("claude-model")).toBe("claude-model")
		expect(convertModelNameForVertex("model-with-short-date-123")).toBe("model-with-short-date-123")
	})

	test("should only convert 8-digit date patterns at the end", () => {
		expect(convertModelNameForVertex("claude-20250514-sonnet")).toBe("claude-20250514-sonnet")
		expect(convertModelNameForVertex("model-20250514-with-more")).toBe("model-20250514-with-more")
	})
})

describe("getClaudeCodeModelId", () => {
	test("should return original model when useVertex is false", () => {
		expect(getClaudeCodeModelId("claude-sonnet-4-20250514", false)).toBe("claude-sonnet-4-20250514")
		expect(getClaudeCodeModelId("claude-opus-4-20250514", false)).toBe("claude-opus-4-20250514")
		expect(getClaudeCodeModelId("claude-3-7-sonnet-20250219", false)).toBe("claude-3-7-sonnet-20250219")
	})

	test("should return converted model when useVertex is true", () => {
		expect(getClaudeCodeModelId("claude-sonnet-4-20250514", true)).toBe("claude-sonnet-4@20250514")
		expect(getClaudeCodeModelId("claude-opus-4-20250514", true)).toBe("claude-opus-4@20250514")
		expect(getClaudeCodeModelId("claude-3-7-sonnet-20250219", true)).toBe("claude-3-7-sonnet@20250219")
	})

	test("should default to useVertex false when parameter not provided", () => {
		expect(getClaudeCodeModelId("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514")
	})
})
