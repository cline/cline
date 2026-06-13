import type { McpPromptResponse } from "@shared/mcp"
import { expect } from "chai"
import { formatMcpPromptResponse, McpPromptFetcher, parseSlashCommands } from "../index"
import { reportBugToolResponse, newTaskToolResponse } from "../../prompts/commands"

describe("slash-commands", () => {
	describe("formatMcpPromptResponse", () => {
		it("should format text message", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "text", text: "Hello world" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\nHello world")
		})

		it("should format assistant message", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "assistant", content: { type: "text", text: "I can help" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[Assistant]\nI can help")
		})

		it("should include description when provided", () => {
			const response: McpPromptResponse = {
				description: "Test description",
				messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("Description: Test description")
			expect(result).to.include("[User]\nHello")
		})

		it("should format multiple messages", () => {
			const response: McpPromptResponse = {
				messages: [
					{ role: "user", content: { type: "text", text: "Question" } },
					{ role: "assistant", content: { type: "text", text: "Answer" } },
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("[User]\nQuestion")
			expect(result).to.include("[Assistant]\nAnswer")
		})

		it("should format image content", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "image", data: "base64data", mimeType: "image/png" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Image: image/png]")
		})

		it("should format audio content", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "audio", data: "base64data", mimeType: "audio/mp3" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Audio: audio/mp3]")
		})

		it("should format resource with text", () => {
			const response: McpPromptResponse = {
				messages: [
					{
						role: "user",
						content: {
							type: "resource",
							resource: { uri: "file:///test.txt", text: "File content" },
						},
					},
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("[Resource: file:///test.txt]")
			expect(result).to.include("File content")
		})

		it("should format resource without text", () => {
			const response: McpPromptResponse = {
				messages: [
					{
						role: "user",
						content: {
							type: "resource",
							resource: { uri: "file:///binary.bin" },
						},
					},
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Resource: file:///binary.bin]")
		})
	})

	describe("parseSlashCommands MCP handling", () => {
		const mockMcpPromptFetcher: McpPromptFetcher = async (serverName, promptName) => {
			if (serverName === "test-server" && promptName === "greet") {
				return {
					description: "A greeting prompt",
					messages: [{ role: "user", content: { type: "text", text: "Hello from MCP!" } }],
				}
			}
			return null
		}

		it("should process MCP prompt command in task tag", async () => {
			const text = "<task>/mcp:test-server:greet</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, mockMcpPromptFetcher)

			expect(result.processedText).to.include('<mcp_prompt server="test-server" prompt="greet">')
			expect(result.processedText).to.include("Hello from MCP!")
			expect(result.needsClinerulesFileCheck).to.equal(false)
		})

		it("should process MCP prompt with additional text", async () => {
			const text = "<task>/mcp:test-server:greet Please expand on this</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, mockMcpPromptFetcher)

			expect(result.processedText).to.include('<mcp_prompt server="test-server" prompt="greet">')
			expect(result.processedText).to.include("Please expand on this")
		})

		it("should handle MCP prompt with colons in prompt name", async () => {
			const fetcherWithColons: McpPromptFetcher = async (serverName, promptName) => {
				if (serverName === "server" && promptName === "prompt:with:colons") {
					return {
						messages: [{ role: "user", content: { type: "text", text: "Colon prompt" } }],
					}
				}
				return null
			}

			const text = "<task>/mcp:server:prompt:with:colons</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, fetcherWithColons)

			expect(result.processedText).to.include('prompt="prompt:with:colons"')
			expect(result.processedText).to.include("Colon prompt")
		})

		// Note: Tests for "unknown MCP server", "no fetcher", and "fetcher errors"
		// are skipped because they require StateManager initialization when falling
		// through to workflow checking. The core MCP functionality is covered above.
	})

	describe("reportBugToolResponse", () => {
		it("should include native tool calling instruction when willUseNativeTools is true", () => {
			const response = reportBugToolResponse(true)
			expect(response).to.include("You MUST call the report_bug tool EVEN if it's not in your existing toolset.")
			expect(response).to.include("<explicit_instructions type=\"report_bug\">")
		})

		it("should not include native tool calling instruction when willUseNativeTools is false", () => {
			const response = reportBugToolResponse(false)
			expect(response).to.not.include("You MUST call the report_bug tool EVEN")
			expect(response).to.include("<explicit_instructions type=\"report_bug\">")
		})

		it("should contain all required report_bug fields", () => {
			const response = reportBugToolResponse(false)
			expect(response).to.include("title:")
			expect(response).to.include("what_happened:")
			expect(response).to.include("steps_to_reproduce:")
			expect(response).to.include("api_request_output:")
			expect(response).to.include("additional_context:")
		})
	})

	describe("newTaskToolResponse", () => {
		it("should include native tool calling instruction when willUseNativeTools is true", () => {
			const response = newTaskToolResponse(true)
			expect(response).to.include("You MUST call the new_task tool EVEN if it's not in your existing toolset.")
			expect(response).to.include("<explicit_instructions type=\"new_task\">")
		})

		it("should not include native tool calling instruction when willUseNativeTools is false", () => {
			const response = newTaskToolResponse(false)
			expect(response).to.not.include("You MUST call the new_task tool EVEN")
			expect(response).to.include("<explicit_instructions type=\"new_task\">")
		})
	})
})
