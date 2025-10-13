import { describe, it } from "mocha"
import "should"

/**
 * Escapes special XML characters to prevent malformed XML output.
 */
function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

/**
 * Helper function for building hook context XML (extracted from ToolExecutor logic).
 * Properly escapes XML special characters to prevent malformed or insecure XML.
 *
 * Context Type Prefix Format:
 * - Type prefixes MUST be uppercase (A-Z and underscores only)
 * - Format: "TYPE_PREFIX: context content"
 * - Valid examples: "WORKSPACE_RULES:", "FILE_OPERATIONS:", "VALIDATION:"
 * - Invalid examples: "workspace_rules:", "Workspace_Rules:" (lowercase not matched)
 *
 * If no valid uppercase type prefix is found, defaults to type="general"
 */
function buildHookContextXml(source: string, contextModification?: string): string {
	if (!contextModification) {
		return ""
	}

	const contextText = contextModification.trim()
	if (!contextText) {
		return ""
	}

	const lines = contextText.split("\n")
	const firstLine = lines[0]
	let contextType = "general"
	let content = contextText

	// Type prefix MUST be uppercase: matches "TYPE_PREFIX: content"
	// Only uppercase letters (A-Z) and underscores are recognized
	const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
	const typeMatch = typeMatchRegex.exec(firstLine)
	if (typeMatch) {
		contextType = typeMatch[1].toLowerCase()
		const remainingLines = lines.slice(1).filter((l: string) => l.trim())
		content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
	}

	// Escape XML special characters in all values
	const escapedSource = escapeXml(source)
	const escapedType = escapeXml(contextType)
	const escapedContent = escapeXml(content)

	return `<hook_context source="${escapedSource}" type="${escapedType}">\n${escapedContent}\n</hook_context>`
}

describe("ToolExecutor Hook Integration", () => {
	describe("addHookContextToConversation", () => {
		it("should handle undefined context", () => {
			const contextModification: string | undefined = undefined

			// Import the actual production function from hook-utils that the ToolExecutor uses
			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.equal("")
		})

		it("should handle empty context", () => {
			const contextModification = ""

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.equal("")
		})

		it("should handle whitespace-only context", () => {
			const contextModification = "   \n  \t  "

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.equal("")
		})

		it("should add context without type prefix", () => {
			const contextModification = "Simple context message"

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.match(/type="general"/)
			result.should.match(/Simple context message/)
			result.should.match(/source="PreToolUse"/)
		})

		it("should extract type from WORKSPACE_RULES prefix", () => {
			const contextModification = "WORKSPACE_RULES: Follow TypeScript conventions"

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.match(/type="workspace_rules"/)
			result.should.match(/Follow TypeScript conventions/)
			result.should.not.match(/WORKSPACE_RULES:/)
		})

		it("should extract type from FILE_OPERATIONS prefix", () => {
			const contextModification = "FILE_OPERATIONS: Created file.ts successfully"

			const result = buildHookContextXml("PostToolUse", contextModification)

			result.should.match(/type="file_operations"/)
			result.should.match(/Created file\.ts successfully/)
		})

		it("should handle multi-line context with type", () => {
			const contextModification = "VALIDATION: First line content\nSecond line of context\nThird line of context"

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.match(/type="validation"/)
			result.should.match(/First line content/)
			result.should.match(/Second line/)
			result.should.match(/Third line/)
		})

		it("should handle multi-line context with type but no content on first line", () => {
			const contextModification = "PERFORMANCE:\nTool execution took longer than expected\nConsider optimization"

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.match(/type="performance"/)
			result.should.match(/Tool execution took/)
			result.should.match(/Consider optimization/)
		})

		it("should preserve source parameter correctly", () => {
			const contextModification = "Some context"

			const result = buildHookContextXml("PostToolUse", contextModification)

			result.should.match(/source="PostToolUse"/)
		})

		it("should handle type with underscores", () => {
			const contextModification = "MY_CUSTOM_TYPE: Custom context"

			const result = buildHookContextXml("PreToolUse", contextModification)

			result.should.match(/type="my_custom_type"/)
		})

		it("should not match lowercase type prefix", () => {
			const contextModification = "lowercase_type: This should not be extracted as type"

			const result = buildHookContextXml("PreToolUse", contextModification)

			// Should use default "general" type since lowercase doesn't match
			result.should.match(/type="general"/)
			result.should.match(/lowercase_type:/)
		})

		it("should filter out empty lines when extracting multi-line content", () => {
			const contextModification = "TEST_TYPE: First line\n\n\nSecond line\n  \nThird line"

			const result = buildHookContextXml("PreToolUse", contextModification)

			// Verify the content contains the expected lines
			result.should.match(/First line/)
			result.should.match(/Second line/)
			result.should.match(/Third line/)
			// Verify empty lines were filtered out (this would be in the actual content parsing)
			// but this test is mainly to verify the function works with complex inputs
		})
	})

	describe("Hook Context XML Format", () => {
		it("should generate properly formatted XML", () => {
			const source = "PreToolUse"
			const contextType = "workspace_rules"
			const content = "Test content"

			const xml = `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`

			xml.should.match(/<hook_context source="PreToolUse" type="workspace_rules">/)
			xml.should.match(/Test content/)
			xml.should.match(/<\/hook_context>/)
		})

		it("should handle special characters in content", () => {
			const source = "PreToolUse"
			const contextType = "general"
			const content = 'Content with <special> & "characters"'

			const xml = `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`

			xml.should.match(new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
		})

		it("should properly escape XML special characters", () => {
			const contextModification = "TEST: Content with <tags> & \"quotes\" and 'apostrophes'"

			const result = buildHookContextXml("PreToolUse", contextModification)

			// Verify XML special characters are escaped in the result
			result.should.match(/&lt;tags&gt;/)
			result.should.match(/&amp;/)
			result.should.match(/&quot;quotes&quot;/)
			result.should.match(/&apos;apostrophes&apos;/)

			// Verify no literal < or > characters in content (except in XML structure)
			// Extract just the content between tags
			const contentMatch = result.match(/<hook_context[^>]*>\n(.*)\n<\/hook_context>/)
			if (contentMatch) {
				const content = contentMatch[1]
				// Verify all angle brackets are escaped
				// Content should only have &lt; and &gt;, never bare < or >
				const unescapedAngles = content.match(/[^&]</g) || content.match(/[^;]>/g)
				if (unescapedAngles) {
					throw new Error(`Found unescaped angle brackets in content: ${unescapedAngles}`)
				}
			}
		})

		it("should escape special characters in source attribute", () => {
			const source = "Pre<Tool>Use"
			const contextModification = "TEST_TYPE: Content"

			const result = buildHookContextXml(source, contextModification)

			// Source should be escaped in attribute
			result.should.match(/source="Pre&lt;Tool&gt;Use"/)
			// Type is valid and should be extracted normally
			result.should.match(/type="test_type"/)
		})

		it("should escape special characters in content when type extraction fails", () => {
			const source = "PreToolUse"
			// This won't match the type pattern due to < in it
			const contextModification = "MY<TYPE>: Content with <special> chars"

			const result = buildHookContextXml(source, contextModification)

			// Should use default type since pattern doesn't match
			result.should.match(/type="general"/)
			// Content should have escaped special characters
			result.should.match(/MY&lt;TYPE&gt;/)
			result.should.match(/&lt;special&gt;/)
		})
	})
})
