import { describe, it, expect, vi, beforeEach } from "vitest"
import { GeminiCliHandler } from "../gemini-cli"
import { geminiCliDefaultModelId, geminiCliModels } from "@roo-code/types"
import * as fs from "fs/promises"
import axios from "axios"

vi.mock("fs/promises")
vi.mock("axios")
vi.mock("google-auth-library", () => ({
	OAuth2Client: vi.fn().mockImplementation(() => ({
		setCredentials: vi.fn(),
		refreshAccessToken: vi.fn().mockResolvedValue({
			credentials: {
				access_token: "refreshed-token",
				refresh_token: "refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() + 3600 * 1000,
			},
		}),
		request: vi.fn(),
	})),
}))

describe("GeminiCliHandler", () => {
	let handler: GeminiCliHandler
	const mockCredentials = {
		access_token: "test-access-token",
		refresh_token: "test-refresh-token",
		token_type: "Bearer",
		expiry_date: Date.now() + 3600 * 1000,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		;(fs.readFile as any).mockResolvedValue(JSON.stringify(mockCredentials))
		;(fs.writeFile as any).mockResolvedValue(undefined)

		// Set up default mock
		;(axios.post as any).mockResolvedValue({
			data: {},
		})

		handler = new GeminiCliHandler({
			apiModelId: geminiCliDefaultModelId,
		})

		// Set up default mock for OAuth2Client request
		handler["authClient"].request = vi.fn().mockResolvedValue({
			data: {},
		})

		// Mock the discoverProjectId to avoid real API calls in tests
		handler["projectId"] = "test-project-123"
		vi.spyOn(handler as any, "discoverProjectId").mockResolvedValue("test-project-123")
	})

	describe("constructor", () => {
		it("should initialize with provided config", () => {
			expect(handler["options"].apiModelId).toBe(geminiCliDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return correct model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(geminiCliDefaultModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.inputPrice).toBe(0)
			expect(modelInfo.info.outputPrice).toBe(0)
		})

		it("should return default model if invalid model specified", () => {
			const invalidHandler = new GeminiCliHandler({
				apiModelId: "invalid-model",
			})
			const modelInfo = invalidHandler.getModel()
			expect(modelInfo.id).toBe(geminiCliDefaultModelId)
		})

		it("should handle :thinking suffix", () => {
			const thinkingHandler = new GeminiCliHandler({
				apiModelId: "gemini-2.5-pro:thinking",
			})
			const modelInfo = thinkingHandler.getModel()
			// The :thinking suffix should be removed from the ID
			expect(modelInfo.id).toBe("gemini-2.5-pro")
			// But the model should still have reasoning support
			expect(modelInfo.info.supportsReasoningBudget).toBe(true)
			expect(modelInfo.info.requiredReasoningBudget).toBe(true)
		})
	})

	describe("OAuth authentication", () => {
		it("should load OAuth credentials from default path", async () => {
			await handler["loadOAuthCredentials"]()
			expect(fs.readFile).toHaveBeenCalledWith(expect.stringMatching(/\.gemini[/\\]oauth_creds\.json$/), "utf-8")
		})

		it("should load OAuth credentials from custom path", async () => {
			const customHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
				geminiCliOAuthPath: "/custom/path/oauth.json",
			})
			await customHandler["loadOAuthCredentials"]()
			expect(fs.readFile).toHaveBeenCalledWith("/custom/path/oauth.json", "utf-8")
		})

		it("should refresh expired tokens", async () => {
			const expiredCredentials = {
				...mockCredentials,
				expiry_date: Date.now() - 1000, // Expired
			}
			;(fs.readFile as any).mockResolvedValueOnce(JSON.stringify(expiredCredentials))

			await handler["ensureAuthenticated"]()

			expect(handler["authClient"].refreshAccessToken).toHaveBeenCalled()
			expect(fs.writeFile).toHaveBeenCalledWith(
				expect.stringMatching(/\.gemini[/\\]oauth_creds\.json$/),
				expect.stringContaining("refreshed-token"),
			)
		})

		it("should throw error if credentials file not found", async () => {
			;(fs.readFile as any).mockRejectedValueOnce(new Error("ENOENT"))

			await expect(handler["loadOAuthCredentials"]()).rejects.toThrow("errors.geminiCli.oauthLoadFailed")
		})
	})

	describe("project ID discovery", () => {
		it("should use provided project ID", async () => {
			const customHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
				geminiCliProjectId: "custom-project",
			})

			const projectId = await customHandler["discoverProjectId"]()
			expect(projectId).toBe("custom-project")
			expect(customHandler["projectId"]).toBe("custom-project")
		})

		it("should discover project ID through API", async () => {
			// Create a new handler without the mocked discoverProjectId
			const testHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
			})
			testHandler["authClient"].request = vi.fn().mockResolvedValue({
				data: {},
			})

			// Mock the callEndpoint method
			testHandler["callEndpoint"] = vi.fn().mockResolvedValueOnce({
				cloudaicompanionProject: "discovered-project-123",
			})

			const projectId = await testHandler["discoverProjectId"]()
			expect(projectId).toBe("discovered-project-123")
			expect(testHandler["projectId"]).toBe("discovered-project-123")
		})

		it("should onboard user if no existing project", async () => {
			// Create a new handler without the mocked discoverProjectId
			const testHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
			})
			testHandler["authClient"].request = vi.fn().mockResolvedValue({
				data: {},
			})

			// Mock the callEndpoint method
			testHandler["callEndpoint"] = vi
				.fn()
				.mockResolvedValueOnce({
					allowedTiers: [{ id: "free-tier", isDefault: true }],
				})
				.mockResolvedValueOnce({
					done: false,
				})
				.mockResolvedValueOnce({
					done: true,
					response: {
						cloudaicompanionProject: {
							id: "onboarded-project-456",
						},
					},
				})

			const projectId = await testHandler["discoverProjectId"]()
			expect(projectId).toBe("onboarded-project-456")
			expect(testHandler["projectId"]).toBe("onboarded-project-456")
			expect(testHandler["callEndpoint"]).toHaveBeenCalledTimes(3)
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [
						{
							content: {
								parts: [{ text: "Test response" }],
							},
						},
					],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
		})

		it("should handle empty response", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should filter out thinking parts", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [
						{
							content: {
								parts: [{ text: "Thinking...", thought: true }, { text: "Actual response" }],
							},
						},
					],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Actual response")
		})

		it("should handle API errors", async () => {
			handler["authClient"].request = vi.fn().mockRejectedValue(new Error("API Error"))

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("errors.geminiCli.completionError")
		})
	})

	describe("createMessage streaming", () => {
		it("should handle streaming response with reasoning", async () => {
			// Create a mock Node.js readable stream
			const { Readable } = require("stream")
			const mockStream = new Readable({
				read() {
					this.push('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n')
					this.push(
						'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking..."}]}}]}\n\n',
					)
					this.push(
						'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n',
					)
					this.push("data: [DONE]\n\n")
					this.push(null) // End the stream
				},
			})

			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: mockStream,
			})

			const stream = handler.createMessage("System", [])
			const chunks: any[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check we got the expected chunks
			expect(chunks).toHaveLength(4) // 2 text chunks, 1 reasoning chunk, 1 usage chunk

			// Filter out only text chunks (not reasoning chunks)
			const textChunks = chunks.filter((c) => c.type === "text").map((c) => c.text)
			expect(textChunks).toEqual(["Hello", " world"])

			// Check reasoning chunk
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(1)
			expect(reasoningChunks[0].text).toBe("thinking...")

			// Check usage chunk
			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toMatchObject({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				totalCost: 0,
			})
		})

		it("should handle rate limit errors", async () => {
			handler["authClient"].request = vi.fn().mockRejectedValue({
				response: {
					status: 429,
					data: { error: { message: "Rate limit exceeded" } },
				},
			})

			const stream = handler.createMessage("System", [])

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should throw before yielding
				}
			}).rejects.toThrow("errors.geminiCli.rateLimitExceeded")
		})
	})

	describe("countTokens", () => {
		it("should fall back to base provider implementation", async () => {
			const content = [{ type: "text" as const, text: "Hello world" }]
			const tokenCount = await handler.countTokens(content)

			// Should return a number (tiktoken fallback)
			expect(typeof tokenCount).toBe("number")
			expect(tokenCount).toBeGreaterThan(0)
		})
	})
})
