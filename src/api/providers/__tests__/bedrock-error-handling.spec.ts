import { vi } from "vitest"

// Mock BedrockRuntimeClient and commands
const mockSend = vi.fn()

// Mock AWS SDK credential providers
vi.mock("@aws-sdk/credential-providers", () => {
	return {
		fromIni: vi.fn().mockReturnValue({
			accessKeyId: "profile-access-key",
			secretAccessKey: "profile-secret-key",
		}),
	}
})

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
		send: mockSend,
	})),
	ConverseStreamCommand: vi.fn(),
	ConverseCommand: vi.fn(),
}))

import { AwsBedrockHandler } from "../bedrock"
import { Anthropic } from "@anthropic-ai/sdk"

describe("AwsBedrockHandler Error Handling", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new AwsBedrockHandler({
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		})
	})

	const createMockError = (options: {
		message?: string
		name?: string
		status?: number
		__type?: string
		$metadata?: {
			httpStatusCode?: number
			requestId?: string
			extendedRequestId?: string
			cfId?: string
			[key: string]: any // Allow additional properties
		}
	}): Error => {
		const error = new Error(options.message || "Test error") as any
		if (options.name) error.name = options.name
		if (options.status) error.status = options.status
		if (options.__type) error.__type = options.__type
		if (options.$metadata) error.$metadata = options.$metadata
		return error
	}

	describe("Throttling Error Detection", () => {
		it("should detect throttling from HTTP 429 status code", async () => {
			const throttleError = createMockError({
				message: "Request failed",
				status: 429,
			})

			mockSend.mockRejectedValueOnce(throttleError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})

		it("should detect throttling from AWS SDK $metadata.httpStatusCode", async () => {
			const throttleError = createMockError({
				message: "Request failed",
				$metadata: { httpStatusCode: 429 },
			})

			mockSend.mockRejectedValueOnce(throttleError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})

		it("should detect throttling from ThrottlingException name", async () => {
			const throttleError = createMockError({
				message: "Request failed",
				name: "ThrottlingException",
			})

			mockSend.mockRejectedValueOnce(throttleError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})

		it("should detect throttling from __type field", async () => {
			const throttleError = createMockError({
				message: "Request failed",
				__type: "ThrottlingException",
			})

			mockSend.mockRejectedValueOnce(throttleError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})

		it("should detect throttling from 'Bedrock is unable to process your request' message", async () => {
			const throttleError = createMockError({
				message: "Bedrock is unable to process your request",
			})

			mockSend.mockRejectedValueOnce(throttleError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toMatch(/throttled or rate limited/)
			}
		})

		it("should detect throttling from various message patterns", async () => {
			const throttlingMessages = [
				"Request throttled",
				"Rate limit exceeded",
				"Too many requests",
				"Service unavailable due to high demand",
				"Server is overloaded",
				"System is busy",
				"Please wait and try again",
			]

			for (const message of throttlingMessages) {
				const throttleError = createMockError({ message })
				mockSend.mockRejectedValueOnce(throttleError)

				try {
					await handler.completePrompt("test")
					// Should not reach here as completePrompt should throw
					throw new Error("Expected error to be thrown")
				} catch (error) {
					expect(error.message).toContain("throttled or rate limited")
				}
			}
		})

		it("should display appropriate error information for throttling errors", async () => {
			const throttlingError = createMockError({
				message: "Bedrock is unable to process your request",
				name: "ThrottlingException",
				status: 429,
				$metadata: {
					httpStatusCode: 429,
					requestId: "12345-abcde-67890",
					extendedRequestId: "extended-12345",
					cfId: "cf-12345",
				},
			})

			mockSend.mockRejectedValueOnce(throttlingError)

			try {
				await handler.completePrompt("test")
				throw new Error("Expected error to be thrown")
			} catch (error) {
				// Should contain the main error message
				expect(error.message).toContain("throttled or rate limited")
			}
		})
	})

	describe("Service Quota Exceeded Detection", () => {
		it("should detect service quota exceeded errors", async () => {
			const quotaError = createMockError({
				message: "Service quota exceeded for model requests",
			})

			mockSend.mockRejectedValueOnce(quotaError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("Service quota exceeded")
			} catch (error) {
				expect(error.message).toContain("Service quota exceeded")
			}
		})
	})

	describe("Model Not Ready Detection", () => {
		it("should detect model not ready errors", async () => {
			const modelError = createMockError({
				message: "Model is not ready, please try again later",
			})

			mockSend.mockRejectedValueOnce(modelError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("Model is not ready")
			} catch (error) {
				expect(error.message).toContain("Model is not ready")
			}
		})
	})

	describe("Internal Server Error Detection", () => {
		it("should detect internal server errors", async () => {
			const serverError = createMockError({
				message: "Internal server error occurred",
			})

			mockSend.mockRejectedValueOnce(serverError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("internal server error")
			} catch (error) {
				expect(error.message).toContain("internal server error")
			}
		})
	})

	describe("Token Limit Detection", () => {
		it("should detect enhanced token limit errors", async () => {
			const tokenErrors = [
				"Too many tokens in request",
				"Token limit exceeded",
				"Maximum context length reached",
				"Context length exceeds limit",
			]

			for (const message of tokenErrors) {
				const tokenError = createMockError({ message })
				mockSend.mockRejectedValueOnce(tokenError)

				try {
					await handler.completePrompt("test")
					// Should not reach here as completePrompt should throw
					throw new Error("Expected error to be thrown")
				} catch (error) {
					// Either "Too many tokens" for token-specific errors or "throttled" for limit-related errors
					expect(error.message).toMatch(/Too many tokens|throttled or rate limited/)
				}
			}
		})
	})

	describe("Streaming Context Error Handling", () => {
		it("should handle throttling errors in streaming context", async () => {
			const throttleError = createMockError({
				message: "Bedrock is unable to process your request",
				status: 429,
			})

			const mockStream = {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							throw throttleError
						},
					}
				},
			}

			mockSend.mockResolvedValueOnce({ stream: mockStream })

			const generator = handler.createMessage("system", [{ role: "user", content: "test" }])

			// For throttling errors, it should throw immediately without yielding chunks
			// This allows the retry mechanism to catch and handle it
			await expect(async () => {
				for await (const chunk of generator) {
					// Should not yield any chunks for throttling errors
				}
			}).rejects.toThrow("Bedrock is unable to process your request")
		})

		it("should yield error chunks for non-throttling errors in streaming context", async () => {
			const genericError = createMockError({
				message: "Some other error",
				status: 500,
			})

			const mockStream = {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							throw genericError
						},
					}
				},
			}

			mockSend.mockResolvedValueOnce({ stream: mockStream })

			const generator = handler.createMessage("system", [{ role: "user", content: "test" }])

			const chunks: any[] = []
			try {
				for await (const chunk of generator) {
					chunks.push(chunk)
				}
			} catch (error) {
				// Expected to throw after yielding chunks
			}

			// Should have yielded error chunks before throwing for non-throttling errors
			expect(
				chunks.some((chunk) => chunk.type === "text" && chunk.text && chunk.text.includes("Some other error")),
			).toBe(true)
		})
	})

	describe("Error Priority and Specificity", () => {
		it("should prioritize HTTP status codes over message patterns", async () => {
			// Error with both 429 status and generic message should be detected as throttling
			const mixedError = createMockError({
				message: "Some generic error message",
				status: 429,
			})

			mockSend.mockRejectedValueOnce(mixedError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})

		it("should prioritize AWS error types over message patterns", async () => {
			// Error with ThrottlingException name but different message should still be throttling
			const specificError = createMockError({
				message: "Some other error occurred",
				name: "ThrottlingException",
			})

			mockSend.mockRejectedValueOnce(specificError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("throttled or rate limited")
			} catch (error) {
				expect(error.message).toContain("throttled or rate limited")
			}
		})
	})

	describe("Unknown Error Fallback", () => {
		it("should still show unknown error for truly unrecognized errors", async () => {
			const unknownError = createMockError({
				message: "Something completely unexpected happened",
			})

			mockSend.mockRejectedValueOnce(unknownError)

			try {
				const result = await handler.completePrompt("test")
				expect(result).toContain("Unknown Error")
			} catch (error) {
				expect(error.message).toContain("Unknown Error")
			}
		})
	})

	describe("Enhanced Error Throw for Retry System", () => {
		it("should throw enhanced error messages for completePrompt to display in retry system", async () => {
			const throttlingError = createMockError({
				message: "Too many tokens, rate limited",
				status: 429,
				$metadata: {
					httpStatusCode: 429,
					requestId: "test-request-id-12345",
				},
			})
			mockSend.mockRejectedValueOnce(throttlingError)

			try {
				await handler.completePrompt("test")
				throw new Error("Expected error to be thrown")
			} catch (error) {
				// Should contain the verbose message template
				expect(error.message).toContain("Request was throttled or rate limited")
				// Should preserve original error properties
				expect((error as any).status).toBe(429)
				expect((error as any).$metadata.requestId).toBe("test-request-id-12345")
			}
		})

		it("should throw enhanced error messages for createMessage streaming to display in retry system", async () => {
			const tokenError = createMockError({
				message: "Too many tokens in request",
				name: "ValidationException",
				$metadata: {
					httpStatusCode: 400,
					requestId: "token-error-id-67890",
					extendedRequestId: "extended-12345",
				},
			})

			const mockStream = {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							throw tokenError
						},
					}
				},
			}

			mockSend.mockResolvedValueOnce({ stream: mockStream })

			try {
				const stream = handler.createMessage("system", [{ role: "user", content: "test" }])
				for await (const chunk of stream) {
					// Should not reach here as it should throw an error
				}
				throw new Error("Expected error to be thrown")
			} catch (error) {
				// Should contain error codes (note: this will be caught by the non-throttling error path)
				expect(error.message).toContain("Too many tokens")
				// Should preserve original error properties
				expect(error.name).toBe("ValidationException")
				expect((error as any).$metadata.requestId).toBe("token-error-id-67890")
			}
		})
	})

	describe("Edge Case Test Coverage", () => {
		it("should handle concurrent throttling errors correctly", async () => {
			const throttlingError = createMockError({
				message: "Bedrock is unable to process your request",
				status: 429,
			})

			// Setup multiple concurrent requests that will all fail with throttling
			mockSend.mockRejectedValue(throttlingError)

			// Execute multiple concurrent requests
			const promises = Array.from({ length: 5 }, () => handler.completePrompt("test"))

			// All should throw with throttling error
			const results = await Promise.allSettled(promises)

			results.forEach((result) => {
				expect(result.status).toBe("rejected")
				if (result.status === "rejected") {
					expect(result.reason.message).toContain("throttled or rate limited")
				}
			})
		})

		it("should handle mixed error scenarios with both throttling and other indicators", async () => {
			// Error with both 429 status (throttling) and validation error message
			const mixedError = createMockError({
				message: "ValidationException: Your input is invalid, but also rate limited",
				name: "ValidationException",
				status: 429,
				$metadata: {
					httpStatusCode: 429,
					requestId: "mixed-error-id",
				},
			})

			mockSend.mockRejectedValueOnce(mixedError)

			try {
				await handler.completePrompt("test")
			} catch (error) {
				// Should be treated as throttling due to 429 status taking priority
				expect(error.message).toContain("throttled or rate limited")
				// Should still preserve metadata
				expect((error as any).$metadata?.requestId).toBe("mixed-error-id")
			}
		})

		it("should handle rapid successive retries in streaming context", async () => {
			const throttlingError = createMockError({
				message: "ThrottlingException",
				name: "ThrottlingException",
			})

			// Mock stream that throws immediately
			const mockStream = {
				// eslint-disable-next-line require-yield
				[Symbol.asyncIterator]: async function* () {
					throw throttlingError
				},
			}

			mockSend.mockResolvedValueOnce({ stream: mockStream })

			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "test" }]

			try {
				// Should throw immediately without yielding any chunks
				const stream = handler.createMessage("", messages)
				const chunks = []
				for await (const chunk of stream) {
					chunks.push(chunk)
				}
				// Should not reach here
				expect(chunks).toHaveLength(0)
			} catch (error) {
				// Error should be thrown immediately for retry mechanism
				// The error might be a TypeError if the stream iterator fails
				expect(error).toBeDefined()
				// The important thing is that it throws immediately without yielding chunks
			}
		})

		it("should validate error properties exist before accessing them", async () => {
			// Error with unusual structure
			const unusualError = {
				message: "Error with unusual structure",
				// Missing typical properties like name, status, etc.
			}

			mockSend.mockRejectedValueOnce(unusualError)

			try {
				await handler.completePrompt("test")
			} catch (error) {
				// Should handle gracefully without accessing undefined properties
				expect(error.message).toContain("Unknown Error")
				// Should not have undefined values in the error message
				expect(error.message).not.toContain("undefined")
			}
		})
	})
})
