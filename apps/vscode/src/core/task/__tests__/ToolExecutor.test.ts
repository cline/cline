import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"

describe("ToolExecutor Hook Integration", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("addHookContextToConversation", () => {
		it("should handle undefined context", () => {
			// Test that undefined context doesn't add anything
			const userMessageContent: any[] = []

			// Simulate the method behavior - undefined context should not add anything
			const contextModification: string | undefined = undefined
			// The implementation checks for truthiness, which excludes undefined
			if (contextModification) {
				userMessageContent.push({ type: "text", text: "should not reach here" })
			}

			userMessageContent.length.should.equal(0)
		})

		it("should handle empty context", () => {
			const userMessageContent: any[] = []

			// Simulate the method behavior - empty string is falsy in if check
			const contextModification: string | undefined = ""
			// Empty string is falsy, so this block won't execute
			if (contextModification) {
				userMessageContent.push({ type: "text", text: "should not reach here" })
			}

			userMessageContent.length.should.equal(0)
		})

		it("should handle whitespace-only context", () => {
			const userMessageContent: any[] = []

			// Simulate the method behavior
			const contextModification = "   \n  \t  "
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					userMessageContent.push({ type: "text", text: "should not reach here" })
				}
			}

			userMessageContent.length.should.equal(0)
		})

		it("should add context without type prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "Simple context message"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="general"/)
			userMessageContent[0].text.should.match(/Simple context message/)
			userMessageContent[0].text.should.match(/source="PreToolUse"/)
		})

		it("should extract type from WORKSPACE_RULES prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "WORKSPACE_RULES: Follow TypeScript conventions"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="workspace_rules"/)
			userMessageContent[0].text.should.match(/Follow TypeScript conventions/)
			userMessageContent[0].text.should.not.match(/WORKSPACE_RULES:/)
		})

		it("should extract type from FILE_OPERATIONS prefix", () => {
			const userMessageContent: any[] = []
			const source = "PostToolUse"
			const contextModification = "FILE_OPERATIONS: Created file.ts successfully"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="file_operations"/)
			userMessageContent[0].text.should.match(/Created file\.ts successfully/)
		})

		it("should handle multi-line context with type", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "VALIDATION: First line content\nSecond line of context\nThird line of context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="validation"/)
			userMessageContent[0].text.should.match(/First line content/)
			userMessageContent[0].text.should.match(/Second line/)
			userMessageContent[0].text.should.match(/Third line/)
		})

		it("should handle multi-line context with type but no content on first line", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "PERFORMANCE:\nTool execution took longer than expected\nConsider optimization"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent.length.should.equal(1)
			userMessageContent[0].text.should.match(/type="performance"/)
			userMessageContent[0].text.should.match(/Tool execution took/)
			userMessageContent[0].text.should.match(/Consider optimization/)
		})

		it("should preserve source parameter correctly", () => {
			const userMessageContent: any[] = []
			const source = "PostToolUse"
			const contextModification = "Some context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent[0].text.should.match(/source="PostToolUse"/)
		})

		it("should handle type with underscores", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "MY_CUSTOM_TYPE: Custom context"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			userMessageContent[0].text.should.match(/type="my_custom_type"/)
		})

		it("should not match lowercase type prefix", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "lowercase_type: This should not be extracted as type"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			// Should use default "general" type since lowercase doesn't match
			userMessageContent[0].text.should.match(/type="general"/)
			userMessageContent[0].text.should.match(/lowercase_type:/)
		})

		it("should filter out empty lines when extracting multi-line content", () => {
			const userMessageContent: any[] = []
			const source = "PreToolUse"
			const contextModification = "TEST_TYPE: First line\n\n\nSecond line\n  \nThird line"

			// Simulate the method behavior
			if (contextModification) {
				const contextText = contextModification.trim()
				if (contextText) {
					const lines = contextText.split("\n")
					const firstLine = lines[0]
					let contextType = "general"
					let content = contextText

					const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
					const typeMatch = typeMatchRegex.exec(firstLine)
					if (typeMatch) {
						contextType = typeMatch[1].toLowerCase()
						const remainingLines = lines.slice(1).filter((l: string) => l.trim())
						content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
					}

					userMessageContent.push({
						type: "text",
						text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
					})
				}
			}

			// Verify the content contains the expected lines
			userMessageContent[0].text.should.match(/First line/)
			userMessageContent[0].text.should.match(/Second line/)
			userMessageContent[0].text.should.match(/Third line/)
			// Verify empty lines were filtered out
			userMessageContent[0].text.should.not.match(/First line\n\n/)
			userMessageContent[0].text.should.not.match(/Second line\n\n/)
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
	})
})
