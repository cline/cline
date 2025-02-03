import { describe, it } from "mocha"
import { expect } from "chai"
import { Cline } from "../../core/Cline"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { ChatSettings } from "../../shared/ChatSettings"

// Types for tool use blocks
interface ToolUseBlock {
	type: "tool_use"
	name: string
	params: Record<string, string>
}

interface WriteToFileBlock extends ToolUseBlock {
	name: "write_to_file"
	params: {
		path: string
		content: string
	}
}

interface ReplaceInFileBlock extends ToolUseBlock {
	name: "replace_in_file"
	params: {
		path: string
		diff: string
	}
}

describe("Cline", () => {
	describe("Plan Mode", () => {
		let cline: Cline
		let mockProvider: ClineProvider
		let pushedToolResults: string[] = []
		let checkpointSaved = false

		beforeEach(() => {
			// Reset tool results array
			pushedToolResults = []

			// Mock the minimal provider requirements
			mockProvider = {
				context: {
					globalStorageUri: { fsPath: "/tmp/test" },
				} as any,
			} as ClineProvider

			// Create minimal test settings
			const chatSettings: ChatSettings = {
				mode: "plan",
			}

			// Initialize Cline instance with minimal required settings
			cline = new Cline(
				mockProvider,
				{ apiProvider: "anthropic", apiKey: "test-key" }, // Minimal API config
				{
					enabled: false,
					actions: {
						readFiles: false,
						editFiles: false,
						executeCommands: false,
						useBrowser: false,
						useMcp: false,
					},
					maxRequests: 10,
					enableNotifications: false,
				}, // Minimal auto-approval
				{ headless: true, viewport: { width: 900, height: 600 } }, // Minimal browser settings
				chatSettings,
				undefined,
				"Test task",
			)

			// Mock the pushToolResult method
			;(cline as any).pushToolResult = (result: any) => {
				pushedToolResults.push(result)
			}

			// Mock saveCheckpoint to track calls
			checkpointSaved = false
			;(cline as any).saveCheckpoint = async () => {
				checkpointSaved = true
			}
		})

		describe("write_to_file prevention", () => {
			it("should prevent write_to_file operations", async () => {
				// Create a write_to_file tool use block
				const writeToolBlock: WriteToFileBlock = {
					type: "tool_use",
					name: "write_to_file",
					params: {
						path: "test.txt",
						content: "test content",
					},
				}
				;(cline as any).assistantMessageContent = [writeToolBlock]

				// Simulate write_to_file tool use
				await (cline as any)["presentAssistantMessage"]()

				// Verify error message
				expect(pushedToolResults[0]).to.include("File editing is not allowed in Plan mode")
			})

			it("should allow write_to_file in act mode", async () => {
				// Switch to act mode
				cline.updateChatSettings({
					mode: "act",
				})

				// Create a write_to_file tool use block
				const writeToolBlock: WriteToFileBlock = {
					type: "tool_use",
					name: "write_to_file",
					params: {
						path: "test.txt",
						content: "test content",
					},
				}
				;(cline as any).assistantMessageContent = [writeToolBlock]

				// Simulate write_to_file tool use
				await (cline as any)["presentAssistantMessage"]()

				// Verify no error message about plan mode
				expect(pushedToolResults[0]).to.not.include("File editing is not allowed in Plan mode")
			})
		})

		describe("replace_in_file prevention", () => {
			it("should prevent replace_in_file operations", async () => {
				// Create a replace_in_file tool use block
				const replaceToolBlock: ReplaceInFileBlock = {
					type: "tool_use",
					name: "replace_in_file",
					params: {
						path: "test.txt",
						diff: "test diff",
					},
				}
				;(cline as any).assistantMessageContent = [replaceToolBlock]

				// Simulate replace_in_file tool use
				await (cline as any)["presentAssistantMessage"]()

				// Verify error message
				expect(pushedToolResults[0]).to.include("File editing is not allowed in Plan mode")
			})

			it("should allow replace_in_file in act mode", async () => {
				// Switch to act mode
				cline.updateChatSettings({
					mode: "act",
				})

				// Create a replace_in_file tool use block
				const replaceToolBlock: ReplaceInFileBlock = {
					type: "tool_use",
					name: "replace_in_file",
					params: {
						path: "test.txt",
						diff: "test diff",
					},
				}
				;(cline as any).assistantMessageContent = [replaceToolBlock]

				// Simulate replace_in_file tool use
				await (cline as any)["presentAssistantMessage"]()

				// Verify no error message about plan mode
				expect(pushedToolResults[0]).to.not.include("File editing is not allowed in Plan mode")
			})
		})

		describe("mode switching", () => {
			it("should respect mode changes", async () => {
				// Create a write_to_file tool use block
				const writeToolBlock: WriteToFileBlock = {
					type: "tool_use",
					name: "write_to_file",
					params: {
						path: "test.txt",
						content: "test content",
					},
				}

				// Start in plan mode and verify prevention
				;(cline as any).assistantMessageContent = [writeToolBlock]
				await (cline as any)["presentAssistantMessage"]()
				expect(pushedToolResults[0]).to.include("File editing is not allowed in Plan mode")

				// Switch to act mode and verify allowance
				cline.updateChatSettings({
					mode: "act",
				})
				pushedToolResults = [] // Reset results
				;(cline as any).assistantMessageContent = [writeToolBlock]
				await (cline as any)["presentAssistantMessage"]()
				expect(pushedToolResults[0]).to.not.include("File editing is not allowed in Plan mode")

				// Switch back to plan mode and verify prevention
				cline.updateChatSettings({
					mode: "plan",
				})
				pushedToolResults = [] // Reset results
				;(cline as any).assistantMessageContent = [writeToolBlock]
				await (cline as any)["presentAssistantMessage"]()
				expect(pushedToolResults[0]).to.include("File editing is not allowed in Plan mode")
			})
		})

		describe("checkpoint behavior", () => {
			it("should save checkpoint after preventing file edit", async () => {
				// Create a write_to_file tool use block
				const writeToolBlock: WriteToFileBlock = {
					type: "tool_use",
					name: "write_to_file",
					params: {
						path: "test.txt",
						content: "test content",
					},
				}
				;(cline as any).assistantMessageContent = [writeToolBlock]

				// Verify checkpoint wasn't saved before
				expect(checkpointSaved).to.be.false

				// Simulate write_to_file tool use
				await (cline as any)["presentAssistantMessage"]()

				// Verify checkpoint was saved after prevention
				expect(checkpointSaved).to.be.true
			})
		})
	})
})
