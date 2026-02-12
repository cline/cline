import type { McpPromptResponse } from "@shared/mcp"
import { expect } from "chai"
import fs from "fs/promises"
import * as sinon from "sinon"
import * as skillsUtils from "../../context/instructions/user-instructions/skills"
import { formatMcpPromptResponse, McpPromptFetcher, parseSlashCommands } from "../index"

describe("slash-commands", () => {
	afterEach(() => {
		sinon.restore()
	})

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

	describe("parseSlashCommands skill handling", () => {
		it("should process skill command in task tag", async () => {
			sinon.stub(skillsUtils, "getSkillContent").resolves({
				name: "debug-build",
				description: "Debug build issues",
				path: "/tmp/skills/debug-build/SKILL.md",
				source: "project",
				instructions: "Step 1: inspect logs.\nStep 2: propose fix.",
			})

			const text = "<task>/debug-build investigate this failure</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, undefined, [
				{
					name: "debug-build",
					description: "Debug build issues",
					path: "/tmp/skills/debug-build/SKILL.md",
					source: "project",
				},
			])

			expect(result.processedText).to.include('<explicit_instructions type="skill:debug-build">')
			expect(result.processedText).to.include("Step 1: inspect logs.")
			expect(result.processedText).to.include("investigate this failure")
		})

		it("should prefer skill over workflow on name collision", async () => {
			const readFileStub = sinon.stub(fs, "readFile").resolves("workflow instructions")
			sinon.stub(skillsUtils, "getSkillContent").resolves({
				name: "release-checklist",
				description: "Release checklist",
				path: "/tmp/skills/release-checklist/SKILL.md",
				source: "global",
				instructions: "skill instructions",
			})

			const text = "<task>/release-checklist run this now</task>"
			const result = await parseSlashCommands(
				text,
				{
					"/tmp/.clinerules/workflows/release-checklist.md": true,
				},
				{},
				"test-ulid",
				undefined,
				false,
				undefined,
				undefined,
				[
					{
						name: "release-checklist",
						description: "Release checklist",
						path: "/tmp/skills/release-checklist/SKILL.md",
						source: "global",
					},
				],
			)

			expect(result.processedText).to.include('<explicit_instructions type="skill:release-checklist">')
			expect(result.processedText).to.include("skill instructions")
			expect(result.processedText).to.not.include("workflow instructions")
			expect(readFileStub.called).to.equal(false)
		})

		it("should support workflow command without file extension", async () => {
			sinon.stub(fs, "readFile").resolves("workflow instructions")

			const text = "<task>/git-branch-analysis please run</task>"
			const result = await parseSlashCommands(
				text,
				{
					"/tmp/.clinerules/workflows/git-branch-analysis.md": true,
				},
				{},
				"test-ulid",
			)

			expect(result.processedText).to.include('<explicit_instructions type="git-branch-analysis.md">')
			expect(result.processedText).to.include("workflow instructions")
		})
	})
})
