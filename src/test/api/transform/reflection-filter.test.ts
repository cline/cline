/**
 * Test Suite: Reflection Filter for Response Quality
 *
 * This suite verifies the effectiveness of the reflection filter, which prevents
 * language models from reflecting environment details back in their responses.
 *
 * The filter helps with:
 * - Eliminating clutter by removing irrelevant environment information
 * - Improving response quality by focusing on the actual task content
 * - Keeping unwanted file paths and system details out of generated content
 * - Streamlining the coding workflow by reducing manual cleanup
 *
 * Testing approach:
 * - Verifies both the standalone filter function and its integration with message handlers
 * - Tests multiple reflection patterns that could appear in responses
 * - Confirms both filtering modes: "remove" (silently removes content) and "replace" (adds message)
 * - Ensures legitimate content passes through unmodified
 */

// Replace ESM import with CommonJS require for Mocha compatibility in VS Code's test runner
const mocha = require("mocha")
const { describe, it } = mocha
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import { filterReflections, createMessageWithReflectionFilter } from "../../../api/transform/reflection-filter"
import { ApiStream, ApiStreamChunk, ApiStreamTextChunk, ApiStreamUsageChunk } from "../../../api/transform/stream"
import { createMockApiStream } from "../../utils/gemini-mocks"

describe("Reflection Filter", () => {
	describe("filterReflections", () => {
		/**
		 * Verifies that legitimate content without reflections passes through the filter unchanged.
		 * This ensures the filter doesn't inadvertently block or modify normal responses,
		 * including code snippets that might superficially resemble environment details.
		 */
		it("should pass through text chunks without reflections", async () => {
			// Arrange - Create a stream with normal content including harmless code blocks
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response without any reflections." },
				{ type: "text", text: "Here's some code: ```console.log('Hello')```" },
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act - Pass the stream through the filter
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream)) {
				filteredChunks.push(chunk)
			}

			// Assert - Verify all chunks pass through unchanged
			expect(filteredChunks).to.deep.equal(chunks)
		})

		/**
		 * Verifies that the "remove" filtering mode correctly eliminates chunks
		 * containing environment details while preserving other content.
		 * This mode is useful when you want to silently filter out reflections
		 * for a cleaner output without interruptions.
		 */
		it("should filter out chunks with environment details reflections", async () => {
			// Arrange - Create a stream with a system information chunk
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "# System Information\nOperating System: Windows 10\nDefault Shell: PowerShell",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act - Apply the filter in "remove" mode
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream, { filterMode: "remove" })) {
				filteredChunks.push(chunk)
			}

			// Assert - Verify the middle chunk is removed entirely
			expect(filteredChunks).to.deep.equal([
				{ type: "text", text: "This is a normal response." },
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			])
		})

		/**
		 * Verifies that the "replace" filtering mode (the default) substitutes
		 * environment details with a warning message instead of removing them entirely.
		 * This mode provides transparency to users about the filtering action while
		 * still keeping the output clean.
		 */
		it("should replace chunks containing reflections with warning message", async () => {
			// Arrange - Create a stream with a VSCode file listing
			const chunks: ApiStreamChunk[] = [
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "# VSCode Open Tabs\n- src/index.ts\n- src/utils.ts\n- README.md",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			]
			const mockStream = createMockApiStream(chunks)

			// Act - Apply the filter in "replace" mode (default)
			const filteredChunks = []
			for await (const chunk of filterReflections(mockStream, { filterMode: "replace" })) {
				filteredChunks.push(chunk)
			}

			// Assert - Verify the chunk is replaced with a warning message
			expect(filteredChunks).to.deep.equal([
				{ type: "text", text: "This is a normal response." },
				{
					type: "text",
					text: "[Note: Some content was filtered to remove environment details]",
				},
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
			])
		})

		/**
		 * Comprehensive test of the filter's pattern detection capabilities.
		 * Tests various patterns that might appear in reflections to ensure
		 * they are correctly identified and handled.
		 *
		 * Thorough pattern coverage ensures consistent filtering of
		 * unwanted environment information.
		 */
		it("should detect various patterns of reflections", async () => {
			// Arrange - Define a comprehensive set of potential reflection patterns
			const reflectionPatterns = [
				// Section headers from environment_details
				"# VSCode Open Tabs\n- file1.ts\n- file2.ts",
				"<environment_details>\nSome content\n</environment_details>",
				"# Current Time: 2023-01-01T12:00:00Z",
				"# System Information\nOS: Windows",
				"# Actively Running Terminals\n- Terminal 1: npm start",

				// System information patterns
				"Operating System: macOS 13.4.1",
				"Default Shell: /bin/zsh",
				"Home Directory: /Users/username",
				"Current Working Directory: /Users/username/projects",

				// File/terminal related patterns
				"final_file_content: const x = 1;",
				"```terminal output\n> npm start\n> Compiled successfully!\n```",

				// Extended file listings
				"Here's a file list:\n- file1.ts\n- file2.ts\n- file3.ts\n- file4.ts\n- file5.ts\n- file6.ts",
			]

			// Test each pattern individually for comprehensive coverage
			for (const pattern of reflectionPatterns) {
				const chunks: ApiStreamChunk[] = [{ type: "text", text: pattern }]
				const mockStream = createMockApiStream(chunks)

				// Act - Apply the filter in "remove" mode with warnings disabled
				const filteredChunks = []
				for await (const chunk of filterReflections(mockStream, { filterMode: "remove", logWarnings: false })) {
					filteredChunks.push(chunk)
				}

				// Assert - No chunks should pass through (all should be filtered)
				expect(filteredChunks).to.have.lengthOf(0, `Failed to filter pattern: ${pattern}`)
			}
		})
	})

	describe("createMessageWithReflectionFilter", () => {
		/**
		 * Verifies the higher-order function that wraps API provider message functions
		 * with reflection filtering capabilities.
		 *
		 * This function is the integration point between the filter and all API providers,
		 * applied centrally in buildApiHandler() to improve response quality consistently.
		 *
		 * The test confirms that:
		 * 1. Normal content passes through unmodified
		 * 2. Environment details are properly filtered
		 * 3. The overall structure (sequence of chunks) is maintained
		 */
		it("should wrap a createMessage function with reflection filtering", async () => {
			// Arrange - Create a mock API handler's createMessage function
			// The mock yields a normal response followed by environment details
			const mockCreateMessage = async function* (systemPrompt: string, messages: any[]): ApiStream {
				yield { type: "text", text: "Normal response" } as ApiStreamTextChunk
				yield { type: "text", text: "# System Information\nOS: Linux" } as ApiStreamTextChunk
				yield { type: "usage", inputTokens: 10, outputTokens: 5 } as ApiStreamUsageChunk
			}

			// Act - Wrap the mock function with the reflection filter
			const wrappedCreateMessage = createMessageWithReflectionFilter(mockCreateMessage)
			const filteredChunks: ApiStreamChunk[] = []

			// Collect all chunks from the wrapped function
			for await (const chunk of wrappedCreateMessage("test prompt", [])) {
				filteredChunks.push(chunk)
			}

			// Assert - Verify the filtering was applied correctly
			// Should have 3 chunks: normal text + warning message + usage
			expect(filteredChunks).to.have.lengthOf(3)

			// First chunk (normal content) should pass through unchanged
			expect(filteredChunks[0]).to.deep.equal({ type: "text", text: "Normal response" })

			// Second chunk (environment details) should be replaced with a warning
			expect(filteredChunks[1].type).to.equal("text")
			if (filteredChunks[1].type === "text") {
				expect(filteredChunks[1].text).to.include("[Note:") // Warning message
			} else {
				expect.fail("Second chunk should be a text chunk")
			}

			// Third chunk (usage metadata) should pass through unchanged
			expect(filteredChunks[2].type).to.equal("usage")
		})
	})
})
