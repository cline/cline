import { describe, it, beforeEach } from "mocha"
import { expect } from "chai"
import * as sinon from "sinon"
import { DownloadFileHandler } from "../DownloadFileHandler"
import type { ToolUse } from "@core/assistant-message"
import type { TaskConfig } from "../../types/TaskConfig"

describe("DownloadFileHandler", () => {
	let handler: DownloadFileHandler
	let mockConfig: any

	beforeEach(() => {
		handler = new DownloadFileHandler()
		
		// Mock config
		mockConfig = {
			taskId: "test-task",
			ulid: "test-ulid",
			cwd: "/test/cwd",
			mode: "act",
			strictPlanModeEnabled: false,
			context: {} as any,
			taskState: {
				consecutiveMistakeCount: 0,
				didRejectTool: false,
				didAlreadyUseTool: false,
				userMessageContent: [],
			} as any,
			messageState: {} as any,
			api: {} as any,
			autoApprovalSettings: {
				enabled: false,
				enableNotifications: false,
			} as any,
			autoApprover: {} as any,
			browserSettings: {} as any,
			focusChainSettings: {} as any,
			services: {} as any,
			callbacks: {} as any,
			coordinator: {} as any,
		}
	})

	describe("getDescription", () => {
		it("should return a proper description", () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "download_file",
				params: {
					url: "https://example.com/test.txt",
					path: "./test.txt",
				} as any,
				partial: false,
			}
			
			const description = handler.getDescription(block)
			// Since we're using 'any' casting, the description will contain the values
			expect(description).to.include("download_file")
		})
	})

	describe("execute", () => {
		it("should return error when fileUrl is missing", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "download_file",
				params: {
					path: "./test.txt",
				} as any,
				partial: false,
			}
			
			const result = await handler.execute(mockConfig, block)
			expect(result).to.equal("Missing required parameter: fileUrl")
			expect(mockConfig.taskState.consecutiveMistakeCount).to.equal(1)
		})

		it("should return error when savePath is missing", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "download_file",
				params: {
					url: "https://example.com/test.txt",
				} as any,
				partial: false,
			}
			
			const result = await handler.execute(mockConfig, block)
			expect(result).to.equal("Missing required parameter: savePath")
			expect(mockConfig.taskState.consecutiveMistakeCount).to.equal(1)
		})
	})
})