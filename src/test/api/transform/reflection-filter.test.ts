/**
 * Test suite for reflection filter.
 *
 * Tests the detection and filtering of environment details reflections in API responses.
 */

// Replace ESM import with CommonJS require for Mocha compatibility in VS Code's test runner
const mocha = require("mocha")
const { describe, it } = mocha
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import { filterReflections, createMessageWithReflectionFilter } from "../../../api/transform/reflection-filter"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { createMockApiStream } from "../../utils/gemini-mocks"

describe("Reflection Filter", () => {
	describe("filterReflections", () => {
		it("should pass through text chunks without reflections", async () => {
			// Arrange
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response without any reflections." },
				{ type: "text", text: "Here's some code: ```console.log('Hello')```" },
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream)) {
				filteredChunks.push(chunk)
			}

			// Assert
			expect(filteredChunks).to.deep.equal(chunks)
		})

		it("should filter out chunks with environment details reflections", async () => {
			// Arrange
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "# System Information\nOperating System: Windows 10\nDefault Shell: PowerShell",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream, { filterMode: "remove" })) {
				filteredChunks.push(chunk)
			}

			// Assert
			// The middle chunk should be filtered out
			expect(filteredChunks).to.deep.equal([
				{ type: "text", text: "This is a normal response." },
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			])
		})

		it("should replace chunks containing reflections with warning message", async () => {
			// Arrange
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "# VSCode Open Tabs\n- src/index.ts\n- src/utils.ts\n- README.md",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream, { filterMode: "replace" })) {
				filteredChunks.push(chunk)
			}

			// Assert
			// The middle chunk should be replaced with a warning
			expect(filteredChunks).to.deep.equal([
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "[Note: Some content was filtered to prevent reflection of environment details]",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			])
		})

		it("should detect various patterns of reflections", async () => {
			// Arrange
			const reflectionPatterns = [
				"# VSCode Open Tabs\n- file1.ts\n- file2.ts",
				"<environment_details>\nSome content\n</environment_details>",
				"# Current Time: 2023-01-01T12:00:00Z",
				"# System Information\nOS: Windows",
				"# Actively Running Terminals\n- Terminal 1: npm start",
				"Operating System: macOS 13.4.1",
				"Default Shell: /bin/zsh",
				"Home Directory: /Users/username",
				"Current Working Directory: /Users/username/projects",
				"final_file_content: const x = 1;",
				"```terminal output\n> npm start\n> Compiled successfully!\n```",
				"Here's a file list:\n- file1.ts\n- file2.ts\n- file3.ts\n- file4.ts\n- file5.ts\n- file6.ts",
			]

			// Test each pattern individually
			for (const pattern of reflectionPatterns) {
				const chunks: ApiStreamChunk[] = [{ type: "text", text: pattern }]
				const mockStream = createMockApiStream(chunks)

				// Act
				const filteredChunks = []
				for await (const chunk of filterReflections(mockStream, { filterMode: "remove", logWarnings: false })) {
					filteredChunks.push(chunk)
				}

				// Assert - no chunks should pass through
				expect(filteredChunks).to.have.lengthOf(0, `Failed to filter pattern: ${pattern}`)
			}
		})
	})

	describe("createMessageWithReflectionFilter", () => {
		it("should wrap a createMessage function with reflection filtering", async () => {
			// Arrange
			const mockCreateMessage = async function* (systemPrompt: string, messages: any[]) {
				yield { type: "text", text: "Normal response" }
				yield { type: "text", text: "# System Information\nOS: Linux" }
				yield { type: "usage", inputTokens: 10, outputTokens: 5 }
			}

			// Act
			const wrappedCreateMessage = createMessageWithReflectionFilter(mockCreateMessage)
			const filteredChunks = []
			for await (const chunk of wrappedCreateMessage("test prompt", [])) {
				filteredChunks.push(chunk)
			}

			// Assert
			expect(filteredChunks).to.have.lengthOf(2) // One normal text + usage, but not the system info
			expect(filteredChunks[0]).to.deep.equal({ type: "text", text: "Normal response" })
			expect(filteredChunks[1].type).to.equal("text") // Either warning or filtered content
			expect(filteredChunks[1].text).to.include("[Note:") // Should be replaced with warning
		})
	})
})
