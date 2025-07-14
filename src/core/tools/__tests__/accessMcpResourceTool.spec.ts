import { describe, it, expect, vi, beforeEach } from "vitest"
import { accessMcpResourceTool } from "../accessMcpResourceTool"
import { ToolUse } from "../../../shared/tools"
import { Task } from "../../task/Task"

// Mock the formatResponse module
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolResult: vi.fn(
			(result: string, images?: string[]) =>
				`Tool result: ${result}${images?.length ? ` with ${images.length} images` : ""}`,
		),
	},
}))

describe("accessMcpResourceTool", () => {
	let mockTask: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any

	beforeEach(() => {
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn(),
			say: vi.fn(),
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getMcpHub: vi.fn().mockReturnValue({
						readResource: vi.fn(),
					}),
				}),
			},
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag: string, value: string) => value)
	})

	describe("resource content handling", () => {
		it("should handle text content in text field", async () => {
			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "text/plain",
						text: "Hello, World!",
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", "Hello, World!", [])
			expect(mockPushToolResult).toHaveBeenCalledWith("Tool result: Hello, World!")
		})

		it("should handle text content in blob field with base64 encoding", async () => {
			const textContent = "Hello from blob!"
			const base64Content = Buffer.from(textContent, "utf-8").toString("base64")

			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "text/plain; charset=utf-8",
						blob: base64Content,
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", textContent, [])
			expect(mockPushToolResult).toHaveBeenCalledWith(`Tool result: ${textContent}`)
		})

		it("should handle text content in blob field as raw text", async () => {
			const textContent = "Raw text content"

			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "text/plain",
						blob: textContent,
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", textContent, [])
			expect(mockPushToolResult).toHaveBeenCalledWith(`Tool result: ${textContent}`)
		})

		it("should handle JSON content in blob field", async () => {
			const jsonContent = '{"message": "Hello JSON!"}'
			const base64Content = Buffer.from(jsonContent, "utf-8").toString("base64")

			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "application/json",
						blob: base64Content,
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", jsonContent, [])
			expect(mockPushToolResult).toHaveBeenCalledWith(`Tool result: ${jsonContent}`)
		})

		it("should ignore binary content in blob field", async () => {
			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "image/png",
						blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", "(Empty response)", expect.any(Array))
		})

		it("should handle multiple content items", async () => {
			const textContent1 = "First content"
			const textContent2 = "Second content"
			const base64Content2 = Buffer.from(textContent2, "utf-8").toString("base64")

			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource1",
						mimeType: "text/plain",
						text: textContent1,
					},
					{
						uri: "test://resource2",
						mimeType: "text/plain",
						blob: base64Content2,
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			const expectedContent = `${textContent1}\n\n${textContent2}`
			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", expectedContent, [])
			expect(mockPushToolResult).toHaveBeenCalledWith(`Tool result: ${expectedContent}`)
		})

		it("should show empty response when no valid content is found", async () => {
			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "application/octet-stream",
						blob: "binary-data-here",
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", "(Empty response)", [])
			expect(mockPushToolResult).toHaveBeenCalledWith("Tool result: (Empty response)")
		})

		it("should handle malformed base64 gracefully", async () => {
			const malformedBase64 = "not-valid-base64!"

			const mockResourceResult = {
				contents: [
					{
						uri: "test://resource",
						mimeType: "text/plain",
						blob: malformedBase64,
					},
				],
			}

			mockTask.providerRef.deref().getMcpHub().readResource.mockResolvedValue(mockResourceResult)

			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should fall back to treating it as raw text
			expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", malformedBase64, [])
			expect(mockPushToolResult).toHaveBeenCalledWith(`Tool result: ${malformedBase64}`)
		})
	})

	describe("error handling", () => {
		it("should handle missing server_name parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					uri: "test://resource",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("access_mcp_resource")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("access_mcp_resource", "server_name")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})

		it("should handle missing uri parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "access_mcp_resource",
				partial: false,
				params: {
					server_name: "test-server",
				},
			}

			await accessMcpResourceTool(
				mockTask,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("access_mcp_resource")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("access_mcp_resource", "uri")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})
	})
})
