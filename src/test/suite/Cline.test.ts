import { describe, it } from "mocha"
import { expect } from "chai"
import { Cline } from "../../core/Cline"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { ChatSettings } from "../../shared/ChatSettings"
import { AutoApprovalSettings } from "../../shared/AutoApprovalSettings"
import { BrowserSettings } from "../../shared/BrowserSettings"
import { ApiConfiguration } from "../../shared/api"

describe("Cline", () => {
	describe("Plan Mode", () => {
		let cline: Cline
		let mockProvider: ClineProvider

		beforeEach(() => {
			// Mock the provider
			mockProvider = {
				context: {
					globalStorageUri: { fsPath: "/tmp/test" },
				} as any,
			} as ClineProvider

			// Create test settings
			const chatSettings: ChatSettings = {
				mode: "plan",
			}

			const autoApprovalSettings: AutoApprovalSettings = {
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
			}

			const browserSettings: BrowserSettings = {
				headless: true,
				viewport: {
					width: 900,
					height: 600,
				},
			}

			const apiConfiguration: ApiConfiguration = {
				apiProvider: "anthropic",
				apiKey: "test-key",
			}

			// Initialize Cline instance
			cline = new Cline(
				mockProvider,
				apiConfiguration,
				autoApprovalSettings,
				browserSettings,
				chatSettings,
				undefined,
				"Test task",
			)
		})

		it("should prevent write_to_file operations in plan mode", async () => {
			// Mock the necessary methods
			let toolResult: any
			;(cline as any).pushToolResult = (result: any) => {
				toolResult = result
			}

			// Simulate write_to_file tool use
			await cline["presentAssistantMessage"]()

			// Verify error message
			expect(toolResult).to.include("File editing is not allowed in Plan mode")
		})

		it("should prevent replace_in_file operations in plan mode", async () => {
			// Mock the necessary methods
			let toolResult: any
			;(cline as any).pushToolResult = (result: any) => {
				toolResult = result
			}

			// Simulate replace_in_file tool use
			await cline["presentAssistantMessage"]()

			// Verify error message
			expect(toolResult).to.include("File editing is not allowed in Plan mode")
		})

		it("should allow file operations in act mode", async () => {
			// Switch to act mode
			cline.updateChatSettings({
				...cline["chatSettings"],
				mode: "act",
			})

			// Mock the necessary methods
			let toolResult: any
			;(cline as any).pushToolResult = (result: any) => {
				toolResult = result
			}

			// Simulate write_to_file tool use
			await cline["presentAssistantMessage"]()

			// Verify no error message about plan mode
			expect(toolResult).to.not.include("File editing is not allowed in Plan mode")
		})
	})
})
