import "should"
import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { Readable } from "stream"
import type { AwsBedrockHandlerOptions } from "../bedrock"
import { AwsBedrockHandler } from "../bedrock"

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

		it("should work with AWS_BEARER_TOKEN_BEDROCK", async () => {
			process.env["AWS_BEARER_TOKEN_BEDROCK"] = "test-key"

			const preAWSProfile = process.env["AWS_BEARER_TOKEN_BEDROCK"]

			await AwsBedrockHandler["withTempEnv"](
				() => {
					delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
				},
				async () => {
					should.not.exist(process.env["AWS_BEARER_TOKEN_BEDROCK"])
					return "test"
				},
			)

			process.env["AWS_BEARER_TOKEN_BEDROCK"]!.should.equal(preAWSProfile)
		})
	})

	const mockOptions: AwsBedrockHandlerOptions = {
		apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
		awsRegion: "us-east-1",
		awsAccessKey: "test-key",
		awsSecretKey: "test-secret",
		awsSessionToken: "",
		awsUseProfile: false,
		awsProfile: "",
		awsBedrockApiKey: "",
		awsBedrockUsePromptCache: false,
		awsUseCrossRegionInference: false,
		awsUseGlobalInference: false,
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

	describe("executeConverseStream", () => {
		let handler: AwsBedrockHandler

		beforeEach(() => {
			handler = new AwsBedrockHandler(mockOptions)
		})

		describe("reasoning content handling (deprecated)", () => {
			// These tests are for the old reasoningContent API that may be deprecated
			// Keep them for backward compatibility but they may fail with new API
		})

		describe("thinking response handling (new API structure)", () => {
			it("should handle thinking response in additionalModelResponseFields", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{
						metadata: {
							additionalModelResponseFields: {
								thinkingResponse: {
									reasoning: [
										{
											type: "text",
											text: "まず与えられた数値50.653の立方根を求める必要があります。",
											signature: "sig1",
										},
										{
											type: "text",
											text: "立方根を近似するために数値を3乗したときの誤差を調整していきます。",
											signature: "sig2",
										},
									],
								},
							},
						},
					},
					{ contentBlockDelta: { delta: { text: "50.653の立方根は約3.707です。" }, contentBlockIndex: 0 } },
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

				// Verify thinking steps are yielded before the final answer
				results.should.have.length(4)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("まず与えられた数値50.653の立方根を求める必要があります。")
				results[1].type.should.equal("reasoning")
				results[1].reasoning.should.equal("立方根を近似するために数値を3乗したときの誤差を調整していきます。")
				results[2].type.should.equal("text")
				results[2].text.should.equal("50.653の立方根は約3.707です。")
				results[3].type.should.equal("usage")
			})

			it("should not parse thinking tags in text content", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Regular text that contains thinking tags should NOT be parsed as thinking
					{
						contentBlockDelta: {
							delta: { text: "Let me explain <thinking>this is not real thinking</thinking> in the text." },
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

				// Verify that thinking tags are treated as regular text
				results.should.have.length(1)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Let me explain <thinking>this is not real thinking</thinking> in the text.")
			})

			it("should handle thinking response with empty reasoning array", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{
						metadata: {
							additionalModelResponseFields: {
								thinkingResponse: {
									reasoning: [],
								},
							},
						},
					},
					{ contentBlockDelta: { delta: { text: "Direct response without thinking" }, contentBlockIndex: 0 } },
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

				// Verify only text is returned when reasoning array is empty
				results.should.have.length(1)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Direct response without thinking")
			})

			it("should handle thinking response interleaved with text chunks", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// First, some thinking
					{
						metadata: {
							additionalModelResponseFields: {
								thinkingResponse: {
									reasoning: [{ type: "text", text: "Initial thought process", signature: "sig1" }],
								},
							},
						},
					},
					// Then some text
					{ contentBlockDelta: { delta: { text: "Based on my analysis" }, contentBlockIndex: 0 } },
					// More thinking
					{
						metadata: {
							additionalModelResponseFields: {
								thinkingResponse: {
									reasoning: [{ type: "text", text: "Additional consideration", signature: "sig2" }],
								},
							},
						},
					},
					// Final text
					{ contentBlockDelta: { delta: { text: ", here is the answer." }, contentBlockIndex: 0 } },
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

				// Verify interleaved thinking and text
				results.should.have.length(4)
				results[0].type.should.equal("reasoning")
				results[0].reasoning.should.equal("Initial thought process")
				results[1].type.should.equal("text")
				results[1].text.should.equal("Based on my analysis")
				results[2].type.should.equal("reasoning")
				results[2].reasoning.should.equal("Additional consideration")
				results[3].type.should.equal("text")
				results[3].text.should.equal(", here is the answer.")
			})
		})

		describe("multiple content blocks", () => {
			it("should handle multiple content blocks (reasoning + text)", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Text block only - reasoning is now in additionalModelResponseFields
					{ contentBlockDelta: { delta: { text: "Here is " }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { text: "my response" }, contentBlockIndex: 0 } },
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

				// Verify text chunks are yielded correctly
				results.should.have.length(2)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Here is ")
				results[1].type.should.equal("text")
				results[1].text.should.equal("my response")
			})

			it("should handle real-world Japanese content", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Text block with Japanese response
					{ contentBlockDelta: { delta: { text: "# 生成AIの仕組み - 10歳の君にも分かる説明" }, contentBlockIndex: 0 } },
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

				// Verify Japanese content is handled correctly
				results.should.have.length(1)
				results[0].type.should.equal("text")
				results[0].text.should.equal("# 生成AIの仕組み - 10歳の君にも分かる説明")
			})

			it("should handle interleaved content blocks", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					// Interleaved text blocks
					{ contentBlockDelta: { delta: { text: "Text 1" }, contentBlockIndex: 0 } },
					{ contentBlockDelta: { delta: { text: " Text 2" }, contentBlockIndex: 0 } },
					// Stop blocks
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

				// Verify text chunks are yielded correctly
				results.should.have.length(2)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Text 1")
				results[1].type.should.equal("text")
				results[1].text.should.equal(" Text 2")
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

	describe("getModelId", () => {
		it("should return raw model ID for custom models", async () => {
			const customOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsBedrockCustomSelected: true,
				apiModelId:
					"arn:aws:bedrock:us-west-2:123456789012:custom-model/anthropic.claude-3-5-sonnet-20241022-v2:0/Qk8MMyLmRd",
			}
			const customHandler = new AwsBedrockHandler(customOptions)

			const modelId = await customHandler.getModelId()
			modelId.should.equal(
				"arn:aws:bedrock:us-west-2:123456789012:custom-model/anthropic.claude-3-5-sonnet-20241022-v2:0/Qk8MMyLmRd",
			)
		})

		it("should not encode custom model IDs with slashes", async () => {
			const customOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsBedrockCustomSelected: true,
				apiModelId: "my-namespace/my-custom-model",
			}
			const customHandler = new AwsBedrockHandler(customOptions)

			const modelId = await customHandler.getModelId()
			modelId.should.equal("my-namespace/my-custom-model")
			modelId.should.not.match(/%2F/)
		})

		it("should apply cross-region prefix for non-custom models when enabled", async () => {
			const crossRegionOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				awsRegion: "us-west-2",
			}
			const crossRegionHandler = new AwsBedrockHandler(crossRegionOptions)

			const modelId = await crossRegionHandler.getModelId()
			modelId.should.equal("us.anthropic.claude-3-7-sonnet-20250219-v1:0")
		})

		it("should apply EU cross-region prefix", async () => {
			const euOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				awsRegion: "eu-central-1",
			}
			const euHandler = new AwsBedrockHandler(euOptions)

			const modelId = await euHandler.getModelId()
			modelId.should.equal("eu.anthropic.claude-3-7-sonnet-20250219-v1:0")
		})

		it("should apply JP cross-region prefix for sonnet 4.5", async () => {
			const jpOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsRegion: "ap-northeast-1",
			}
			const jpHandler = new AwsBedrockHandler(jpOptions)

			const modelId = await jpHandler.getModelId()
			modelId.should.equal("jp.anthropic.claude-sonnet-4-5-20250929-v1:0")
		})

		it("should apply global cross-region prefix for supported models", async () => {
			const globalOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				awsUseGlobalInference: true,
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsRegion: "ap-northeast-1",
			}
			const globalHandler = new AwsBedrockHandler(globalOptions)

			const modelId = await globalHandler.getModelId()
			modelId.should.equal("global.anthropic.claude-sonnet-4-5-20250929-v1:0")
		})

		it("should NOT apply global cross-region prefix for unsupported models", async () => {
			const options: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				awsUseGlobalInference: true,
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0", // 3.7 does not support a global inference profile
				awsRegion: "us-west-2",
			}
			const usHandler = new AwsBedrockHandler(options)

			const modelId = await usHandler.getModelId()
			modelId.should.equal("us.anthropic.claude-3-7-sonnet-20250219-v1:0")
		})

		it("should apply APAC cross-region prefix", async () => {
			const apacOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				awsRegion: "ap-northeast-1",
			}
			const apacHandler = new AwsBedrockHandler(apacOptions)

			const modelId = await apacHandler.getModelId()
			modelId.should.equal("apac.anthropic.claude-3-7-sonnet-20250219-v1:0")
		})

		it("should not apply cross-region prefix for custom models even when enabled", async () => {
			const customCrossRegionOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsBedrockCustomSelected: true,
				apiModelId: "arn:aws:bedrock:us-west-2:123456789012:custom-model/my-model",
				awsUseCrossRegionInference: true,
			}
			const customCrossRegionHandler = new AwsBedrockHandler(customCrossRegionOptions)

			const modelId = await customCrossRegionHandler.getModelId()
			modelId.should.equal("arn:aws:bedrock:us-west-2:123456789012:custom-model/my-model")
		})

		it("should handle UltraThink model ARN correctly", async () => {
			const ultraThinkOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsBedrockCustomSelected: true,
				apiModelId:
					"arn:aws:bedrock:us-west-2:123456789012:custom-model/anthropic.claude-3-5-sonnet-20241022-v2:0/Qk8MMyLmRd",
			}
			const ultraThinkHandler = new AwsBedrockHandler(ultraThinkOptions)

			const modelId = await ultraThinkHandler.getModelId()
			// Should return the raw ARN without any encoding
			modelId.should.equal(
				"arn:aws:bedrock:us-west-2:123456789012:custom-model/anthropic.claude-3-5-sonnet-20241022-v2:0/Qk8MMyLmRd",
			)
			modelId.should.not.match(/%2F/)
			modelId.should.not.match(/%3A/)
		})
	})
})
