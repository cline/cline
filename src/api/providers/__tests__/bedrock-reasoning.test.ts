import { AwsBedrockHandler } from "../bedrock"
import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { logger } from "../../../utils/logging"

// Mock the AWS SDK
jest.mock("@aws-sdk/client-bedrock-runtime")
jest.mock("../../../utils/logging")

// Store the command payload for verification
let capturedPayload: any = null

describe("AwsBedrockHandler - Extended Thinking", () => {
	let handler: AwsBedrockHandler
	let mockSend: jest.Mock

	beforeEach(() => {
		capturedPayload = null
		mockSend = jest.fn()

		// Mock ConverseStreamCommand to capture the payload
		;(ConverseStreamCommand as unknown as jest.Mock).mockImplementation((payload) => {
			capturedPayload = payload
			return {
				input: payload,
			}
		})
		;(BedrockRuntimeClient as jest.Mock).mockImplementation(() => ({
			send: mockSend,
			config: { region: "us-east-1" },
		}))
		;(logger.info as jest.Mock).mockImplementation(() => {})
		;(logger.error as jest.Mock).mockImplementation(() => {})
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe("Extended Thinking Support", () => {
		it("should include thinking parameter for Claude Sonnet 4 when reasoning is enabled", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true,
				modelMaxTokens: 8192,
				modelMaxThinkingTokens: 4096,
			})

			// Mock the stream response
			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield {
						messageStart: { role: "assistant" },
					}
					yield {
						contentBlockStart: {
							content_block: { type: "thinking", thinking: "Let me think..." },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { type: "thinking_delta", thinking: " about this problem." },
						},
					}
					yield {
						contentBlockStart: {
							start: { text: "Here's the answer:" },
							contentBlockIndex: 1,
						},
					}
					yield {
						metadata: {
							usage: { inputTokens: 100, outputTokens: 50 },
						},
					}
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the command was called with the correct payload
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 4096, // Uses the full modelMaxThinkingTokens value
			})

			// Verify reasoning chunks were yielded
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(2)
			expect(reasoningChunks[0].text).toBe("Let me think...")
			expect(reasoningChunks[1].text).toBe(" about this problem.")

			// Verify that topP is NOT present when thinking is enabled
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")
		})

		it("should pass thinking parameters from metadata", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsRegion: "us-east-1",
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const metadata = {
				taskId: "test-task",
				thinking: {
					enabled: true,
					maxTokens: 16384,
					maxThinkingTokens: 8192,
				},
			}

			const stream = handler.createMessage("System prompt", messages, metadata)
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the thinking parameter was passed correctly
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 8192,
			})

			// Verify that topP is NOT present when thinking is enabled via metadata
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")
		})

		it("should log when extended thinking is enabled", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-opus-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true,
				modelMaxThinkingTokens: 5000,
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test" }]
			const stream = handler.createMessage("System prompt", messages)

			for await (const chunk of stream) {
				// consume stream
			}

			// Verify logging
			expect(logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Extended thinking enabled"),
				expect.objectContaining({
					ctx: "bedrock",
					modelId: "anthropic.claude-opus-4-20250514-v1:0",
				}),
			)
		})

		it("should include topP when thinking is disabled", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsRegion: "us-east-1",
				// Note: no enableReasoningEffort = true, so thinking is disabled
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield {
						contentBlockStart: {
							start: { text: "Hello" },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { text: " world" },
						},
					}
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that topP IS present when thinking is disabled
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.inferenceConfig).toHaveProperty("topP", 0.1)

			// Verify that additionalModelRequestFields is not present or empty
			expect(capturedPayload.additionalModelRequestFields).toBeUndefined()
		})

		it("should enable reasoning when enableReasoningEffort is true in settings", async () => {
			handler = new AwsBedrockHandler({
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
				awsRegion: "us-east-1",
				enableReasoningEffort: true, // This should trigger reasoning
				modelMaxThinkingTokens: 4096,
			})

			mockSend.mockResolvedValue({
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } }
					yield {
						contentBlockStart: {
							content_block: { type: "thinking", thinking: "Let me think..." },
							contentBlockIndex: 0,
						},
					}
					yield {
						contentBlockDelta: {
							delta: { type: "thinking_delta", thinking: " about this problem." },
						},
					}
					yield { metadata: { usage: { inputTokens: 100, outputTokens: 50 } } }
				})(),
			})

			const messages = [{ role: "user" as const, content: "Test message" }]
			const stream = handler.createMessage("System prompt", messages)

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify thinking was enabled via settings
			expect(mockSend).toHaveBeenCalledTimes(1)
			expect(capturedPayload).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields).toBeDefined()
			expect(capturedPayload.additionalModelRequestFields.thinking).toEqual({
				type: "enabled",
				budget_tokens: 4096,
			})

			// Verify that topP is NOT present when thinking is enabled via settings
			expect(capturedPayload.inferenceConfig).not.toHaveProperty("topP")

			// Verify reasoning chunks were yielded
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(2)
			expect(reasoningChunks[0].text).toBe("Let me think...")
			expect(reasoningChunks[1].text).toBe(" about this problem.")
		})
	})
})
