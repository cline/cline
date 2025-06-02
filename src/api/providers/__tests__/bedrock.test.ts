import "should"
import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "@shared/api"
import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { Readable } from "stream"

describe("AwsBedrockHandler", () => {
	// Helper function to create a mock stream
	function createMockStream(chunks: any[]): Readable {
		const stream = new Readable({
			objectMode: true,
			read() {
				if (chunks.length > 0) {
					this.push(chunks.shift())
				} else {
					this.push(null)
				}
			},
		})
		return stream
	}

	// Helper function to collect generator results
	async function collectGeneratorResults(generator: AsyncGenerator<any>): Promise<any[]> {
		const results: any[] = []
		for await (const item of generator) {
			results.push(item)
		}
		return results
	}

	// Mock AWS Bedrock client
	class MockBedrockClient {
		private streamChunks: any[]

		constructor(streamChunks: any[]) {
			this.streamChunks = streamChunks
		}

		async send(_command: any): Promise<any> {
			return {
				stream: createMockStream(this.streamChunks),
			}
		}
	}

	describe("withTempEnv", () => {
		// Store original env vars for cleanup
		const originalEnv: Record<string, string | undefined> = {}

		beforeEach(() => {
			// Store original values before each test
			originalEnv.TEST_VAR = process.env.TEST_VAR
			originalEnv.ANOTHER_VAR = process.env.ANOTHER_VAR
			originalEnv.VAR1 = process.env.VAR1
			originalEnv.VAR2 = process.env.VAR2
			originalEnv.VAR3 = process.env.VAR3
			originalEnv.UNDEFINED_VAR = process.env.UNDEFINED_VAR
		})

		afterEach(() => {
			// Restore original values after each test
			Object.entries(originalEnv).forEach(([key, value]) => {
				if (value === undefined) {
					delete process.env[key]
				} else {
					process.env[key] = value
				}
			})
		})

		it("should restore original environment variables after operation", async () => {
			// Set initial environment
			process.env.TEST_VAR = "original"
			process.env.ANOTHER_VAR = "another"

			// Store original values
			const originalTestVar = process.env.TEST_VAR
			const originalAnotherVar = process.env.ANOTHER_VAR

			await AwsBedrockHandler["withTempEnv"](
				() => {
					process.env.TEST_VAR = "modified"
					delete process.env.ANOTHER_VAR
				},
				async () => {
					// Verify environment is modified
					process.env.TEST_VAR!.should.equal("modified")
					should.not.exist(process.env.ANOTHER_VAR)
					return "test"
				},
			)

			// Verify environment is restored
			process.env.TEST_VAR!.should.equal(originalTestVar)
			process.env.ANOTHER_VAR!.should.equal(originalAnotherVar)
		})

		it("should handle undefined environment variables", async () => {
			await AwsBedrockHandler["withTempEnv"](
				() => {
					delete process.env.UNDEFINED_VAR
				},
				async () => {
					should.not.exist(process.env.UNDEFINED_VAR)
					return "test"
				},
			)

			// Verify undefined variable is not present
			should.not.exist(process.env.UNDEFINED_VAR)
		})

		it("should handle errors and still restore environment", async () => {
			// Set initial environment
			process.env.TEST_VAR = "original"

			try {
				await AwsBedrockHandler["withTempEnv"](
					() => {
						process.env.TEST_VAR = "modified"
					},
					async () => {
						throw new Error("Test error")
					},
				)
				should.fail(null, null, "Expected error was not thrown", "throw")
			} catch (error) {
				;(error as Error).message.should.equal("Test error")
			}

			// Verify environment is restored even after error
			process.env.TEST_VAR!.should.equal("original")
		})

		it("should handle multiple environment variable changes", async () => {
			// Set initial environment
			process.env.VAR1 = "original1"
			process.env.VAR2 = "original2"
			process.env.VAR3 = "original3"

			// Store original values
			const originalVar1 = process.env.VAR1
			const originalVar2 = process.env.VAR2
			const originalVar3 = process.env.VAR3

			await AwsBedrockHandler["withTempEnv"](
				() => {
					process.env.VAR1 = "modified1"
					process.env.VAR2 = "modified2"
					delete process.env.VAR3
				},
				async () => {
					// Verify environment is modified
					process.env.VAR1!.should.equal("modified1")
					process.env.VAR2!.should.equal("modified2")
					should.not.exist(process.env.VAR3)
					return "test"
				},
			)

			// Verify environment is restored
			process.env.VAR1!.should.equal(originalVar1)
			process.env.VAR2!.should.equal(originalVar2)
			process.env.VAR3!.should.equal(originalVar3)
		})

		it("should work with AWS_PROFILE", async () => {
			process.env["AWS_PROFILE"] = "test-profile"

			const preAWSProfile = process.env["AWS_PROFILE"]

			await AwsBedrockHandler["withTempEnv"](
				() => {
					delete process.env["AWS_PROFILE"]
				},
				async () => {
					should.not.exist(process.env["AWS_PROFILE"])
					return "test"
				},
			)

			process.env["AWS_PROFILE"]!.should.equal(preAWSProfile)
		})
	})

	describe("executeConverseStream", () => {
		let handler: AwsBedrockHandler
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
			awsRegion: "us-east-1",
			awsAccessKey: "test-key",
			awsSecretKey: "test-secret",
			awsSessionToken: "",
			awsUseProfile: false,
			awsProfile: "",
			awsBedrockUsePromptCache: false,
			awsUseCrossRegionInference: false,
			awsBedrockEndpoint: "",
			awsBedrockCustomSelected: false,
			awsBedrockCustomModelBaseId: undefined,
			thinkingBudgetTokens: 1600,
		}

		const mockModelInfo = {
			maxTokens: 8192,
			contextWindow: 200000,
			supportsPromptCache: true,
			supportsImages: true,
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
		}

		beforeEach(() => {
			handler = new AwsBedrockHandler(mockOptions)
		})

		describe("reasoning content handling", () => {
			it("should correctly handle reasoning content in a single block", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "This is " } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "my reasoning" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { signature: "EqgBCkYQ..." } }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
					{ metadata: { usage: { inputTokens: 100, outputTokens: 50 } } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify results - each chunk is yielded separately
				results.should.have.length(3)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("This is ")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal("my reasoning")
				results[2].type.should.equal("usage")
				results[2].inputTokens.should.equal(100)
				results[2].outputTokens.should.equal(50)
			})

			it("should correctly buffer reasoning content across multiple chunks", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Chunk 1 " } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Chunk 2 " } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Chunk 3" } }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify each chunk is yielded separately
				results.should.have.length(3)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("Chunk 1 ")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal("Chunk 2 ")
				results[2].type.should.equal("reasoning")
				results[2].reasoning.should.equal("Chunk 3")
			})

			it("should handle reasoning content with special characters", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Let's think: 2+2=4" } }, contentBlockIndex: 0 } },
					{
						contentBlockDelta: {
							delta: { reasoningContent: { text: "\nAnother line with <tag>" } },
							contentBlockIndex: 0,
						},
					},
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify special characters are preserved in separate chunks
				results.should.have.length(2)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("Let's think: 2+2=4")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal("\nAnother line with <tag>")
			})

			it("should handle reasoning content with signature only", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { reasoningContent: { signature: "EqgBCkYQ..." } }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify signature-only content handling
				results.should.have.length(0) // Current implementation doesn't yield anything for signature-only
			})
		})

		describe("multiple content blocks", () => {
			it("should handle multiple content blocks (reasoning + text)", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Reasoning block (index 0)
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Let me think" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: " about this" } }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					// Text block (index 1)
					{ contentBlockDelta: { delta: { text: "Here is " }, contentBlockIndex: 1 } },
					{ contentBlockDelta: { delta: { text: "my response" }, contentBlockIndex: 1 } },
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify each chunk is yielded separately
				results.should.have.length(4)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("Let me think")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal(" about this")
				results[2].type.should.equal("text")
				results[2].text.should.equal("Here is ")
				results[3].type.should.equal("text")
				results[3].text.should.equal("my response")
			})

			it("should handle real-world Japanese reasoning content", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Reasoning block with Japanese content
					{ contentBlockDelta: { delta: { reasoningContent: { text: "この質問では" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "、生成AI（" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "生成的な人工知能）" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "の仕組みを" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { reasoningContent: { text: "10歳の子どもに" } }, contentBlockIndex: 0 } },
					{
						contentBlockDelta: {
							delta: { reasoningContent: { text: "わかりやすく説明することが求められています。" } },
							contentBlockIndex: 0,
						},
					},
					{ contentBlockStop: { contentBlockIndex: 0 } },
					// Text block with response
					{ contentBlockDelta: { delta: { text: "# 生成AIの仕組み - 10歳の君にも分かる説明" }, contentBlockIndex: 1 } },
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify each Japanese content chunk is yielded separately
				results.should.have.length(7)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("この質問では")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal("、生成AI（")
				results[2].type.should.equal("reasoning")
				results[2].reasoning.should.equal("生成的な人工知能）")
				results[3].type.should.equal("reasoning")
				results[3].reasoning.should.equal("の仕組みを")
				results[4].type.should.equal("reasoning")
				results[4].reasoning.should.equal("10歳の子どもに")
				results[5].type.should.equal("reasoning")
				results[5].reasoning.should.equal("わかりやすく説明することが求められています。")
				results[6].type.should.equal("text")
				results[6].text.should.equal("# 生成AIの仕組み - 10歳の君にも分かる説明")
			})

			it("should handle interleaved content blocks", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Start both blocks
					{ contentBlockDelta: { delta: { reasoningContent: { text: "Reasoning 1" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { text: "Text 1" }, contentBlockIndex: 1 } },
					// Continue both blocks
					{ contentBlockDelta: { delta: { reasoningContent: { text: " Reasoning 2" } }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { text: " Text 2" }, contentBlockIndex: 1 } },
					// Stop blocks
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{ messageStop: { stopReason: "end_turn" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify interleaved chunks are yielded separately
				results.should.have.length(4)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("Reasoning 1")
				results[1].type.should.equal("text")
				results[1].text.should.equal("Text 1")
				results[2].type.should.equal("reasoning")
				results[2].reasoning.should.equal(" Reasoning 2")
				results[3].type.should.equal("text")
				results[3].text.should.equal(" Text 2")
			})
		})

		describe("error handling", () => {
			it("should handle internalServerException", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ internalServerException: { message: "Internal server error occurred" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify error was handled
				results.should.have.length(1)
				results[0].type.should.equal("text")
				results[0].text.should.equal("[ERROR] Internal server error: Internal server error occurred")
			})

			it("should handle throttlingException", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ throttlingException: { message: "Rate limit exceeded" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify error was handled
				results.should.have.length(1)
				results[0].type.should.equal("text")
				results[0].text.should.equal("[ERROR] Throttling error: Rate limit exceeded")
			})
		})

		describe("usage tracking", () => {
			it("should track usage with cache tokens", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { text: "Response" }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
					{
						metadata: {
							usage: {
								inputTokens: 100,
								outputTokens: 50,
								cacheReadInputTokens: 20,
								cacheWriteInputTokens: 30,
							},
						},
					},
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				// Replace getBedrockClient with our mock
				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				// Restore original method
				handler["getBedrockClient"] = originalGetBedrockClient

				// Verify usage tracking
				results.should.have.length(2)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Response")
				results[1].type.should.equal("usage")
				results[1].inputTokens.should.equal(100)
				results[1].outputTokens.should.equal(50)
				results[1].cacheReadTokens.should.equal(20)
				results[1].cacheWriteTokens.should.equal(30)
			})
		})
	})
})
