import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import should from "should"
import { Readable } from "stream"
import type { ClineStorageMessage } from "@/shared/messages/content"
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

		describe("tool use handling", () => {
			it("should handle tool use content blocks", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{
						contentBlockStart: {
							contentBlockIndex: 1,
							start: { toolUse: { toolUseId: "tool-1", name: "read_file" } },
						},
					},
					{
						contentBlockDelta: {
							contentBlockIndex: 1,
							delta: { toolUse: { input: '{"path":' } },
						},
					},
					{
						contentBlockDelta: {
							contentBlockIndex: 1,
							delta: { toolUse: { input: '"test.ts"}' } },
						},
					},
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{ messageStop: { stopReason: "tool_use" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				handler["getBedrockClient"] = originalGetBedrockClient

				results.should.have.length(2)
				results[0].type.should.equal("tool_calls")
				results[0].tool_call.function.id.should.equal("tool-1")
				results[0].tool_call.function.name.should.equal("read_file")
				results[0].tool_call.function.arguments.should.equal('{"path":')
				results[1].type.should.equal("tool_calls")
				results[1].tool_call.function.arguments.should.equal('"test.ts"}')
			})

			it("should handle multiple tool calls", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{
						contentBlockStart: {
							contentBlockIndex: 1,
							start: { toolUse: { toolUseId: "tool-1", name: "read_file" } },
						},
					},
					{
						contentBlockDelta: {
							contentBlockIndex: 1,
							delta: { toolUse: { input: '{"path":"a.ts"}' } },
						},
					},
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{
						contentBlockStart: {
							contentBlockIndex: 2,
							start: { toolUse: { toolUseId: "tool-2", name: "read_file" } },
						},
					},
					{
						contentBlockDelta: {
							contentBlockIndex: 2,
							delta: { toolUse: { input: '{"path":"b.ts"}' } },
						},
					},
					{ contentBlockStop: { contentBlockIndex: 2 } },
					{ messageStop: { stopReason: "tool_use" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				handler["getBedrockClient"] = originalGetBedrockClient

				results.should.have.length(2)
				results[0].tool_call.function.id.should.equal("tool-1")
				results[1].tool_call.function.id.should.equal("tool-2")
			})

			it("should handle text and tool use interleaving", async () => {
				const mockChunks = [
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { text: "Checking" }, contentBlockIndex: 0 } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{
						contentBlockStart: {
							contentBlockIndex: 1,
							start: { toolUse: { toolUseId: "tool-1", name: "read_file" } },
						},
					},
					{
						contentBlockDelta: {
							contentBlockIndex: 1,
							delta: { toolUse: { input: '{"path":"test.ts"}' } },
						},
					},
					{ contentBlockStop: { contentBlockIndex: 1 } },
					{ messageStop: { stopReason: "tool_use" } },
				]

				const mockClient = new MockBedrockClient(mockChunks)
				const command = new ConverseStreamCommand({ modelId: "test-model", messages: [] })

				const originalGetBedrockClient = handler["getBedrockClient"]
				handler["getBedrockClient"] = async () => mockClient as any

				const generator = handler["executeConverseStream"](command, mockModelInfo)
				const results = await collectGeneratorResults(generator)

				handler["getBedrockClient"] = originalGetBedrockClient

				results.should.have.length(2)
				results[0].type.should.equal("text")
				results[0].text.should.equal("Checking")
				results[1].type.should.equal("tool_calls")
			})
		})
	})

	describe("tool config mapping", () => {
		it("should map Anthropic tools to Bedrock toolConfig", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			const toolConfig = handler["mapClineToolsToBedrockToolConfig"]([
				{
					name: "read_file",
					description: "Read a file",
					input_schema: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			])

			toolConfig?.tools?.should.have.length(1)
			const spec = toolConfig?.tools?.[0]?.toolSpec
			spec?.should.not.be.undefined()
			spec?.name?.should.equal("read_file")
			spec?.description?.should.equal("Read a file")
			;(spec as any).inputSchema.json.should.deepEqual({
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			})
		})

		it("should return undefined when tools is undefined or empty", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			should.not.exist(handler["mapClineToolsToBedrockToolConfig"](undefined))
			should.not.exist(handler["mapClineToolsToBedrockToolConfig"]([]))
		})

		it("should silently drop tools without input_schema", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			// A tool missing input_schema doesn't match the AnthropicTool type guard
			const toolConfig = handler["mapClineToolsToBedrockToolConfig"]([
				{ name: "bad_tool", description: "No schema" } as any,
			])
			// All tools filtered out → undefined
			should.not.exist(toolConfig)
		})
	})

	describe("formatMessagesForConverseAPI", () => {
		it("should format tool_use and tool_result blocks", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			const messages: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "ok",
						},
					],
				},
			]

			const formatted = handler["formatMessagesForConverseAPI"](messages)
			const toolUseBlock = formatted[0].content?.[0]?.toolUse
			const toolResultBlock = formatted[1].content?.[0]?.toolResult
			toolUseBlock?.should.not.be.undefined()
			toolResultBlock?.should.not.be.undefined()
			toolUseBlock?.toolUseId?.should.equal("tool-1")
			toolResultBlock?.toolUseId?.should.equal("tool-1")
			toolResultBlock?.content?.[0]?.text?.should.equal("ok")
		})

		it("should format tool_result with array content", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			const messages: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-2",
							content: [
								{ type: "text", text: "line 1" },
								{ type: "text", text: "line 2" },
							],
						},
					],
				},
			]

			const formatted = handler["formatMessagesForConverseAPI"](messages)
			const toolResult = formatted[0].content?.[0]?.toolResult
			toolResult?.toolUseId?.should.equal("tool-2")
			toolResult?.content?.should.have.length(2)
			toolResult?.content?.[0]?.text?.should.equal("line 1")
			toolResult?.content?.[1]?.text?.should.equal("line 2")
		})

		it("should map is_error to error status on tool_result", () => {
			const handler = new AwsBedrockHandler(mockOptions)
			const messages: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-3",
							content: "something went wrong",
							is_error: true,
						},
					],
				},
			]

			const formatted = handler["formatMessagesForConverseAPI"](messages)
			const toolResult = formatted[0].content?.[0]?.toolResult
			toolResult?.status?.should.equal("error")
			toolResult?.content?.[0]?.text?.should.equal("something went wrong")
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

		it("should apply JP cross-region prefix for sonnet 4.6", async () => {
			const jpOptions: AwsBedrockHandlerOptions = {
				...mockOptions,
				awsUseCrossRegionInference: true,
				apiModelId: "anthropic.claude-sonnet-4-6",
				awsRegion: "ap-northeast-1",
			}
			const jpHandler = new AwsBedrockHandler(jpOptions)

			const modelId = await jpHandler.getModelId()
			modelId.should.equal("jp.anthropic.claude-sonnet-4-6")
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

	describe("native tool calling integration", () => {
		it("should be recognized as a next-gen provider eligible for native tool calling", () => {
			// This is the integration gap: if Bedrock is removed from isNextGenModelProvider(),
			// native tool calling silently stops working and falls back to XML tools.
			// Note: requires a Claude 4+ model — Claude 3.x is NOT in the next-gen model family.
			const { isNativeToolCallingConfig } = require("@utils/model-utils")

			const claude4Options: AwsBedrockHandlerOptions = {
				...mockOptions,
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			}
			const handler = new AwsBedrockHandler(claude4Options)
			const model = handler.getModel()
			const providerInfo = {
				providerId: "bedrock",
				model: { id: model.id, info: model.info },
			}

			const result = isNativeToolCallingConfig(providerInfo, true)
			result.should.be.true("Bedrock + Claude 4 should qualify for native tool calling")
		})

		it("should not use native tool calling for pre-4.0 Claude models", () => {
			// Claude 3.x models are NOT in the next-gen family and should use XML tools
			const { isNativeToolCallingConfig } = require("@utils/model-utils")

			const handler = new AwsBedrockHandler(mockOptions) // uses Claude 3.7
			const model = handler.getModel()
			const providerInfo = {
				providerId: "bedrock",
				model: { id: model.id, info: model.info },
			}

			const result = isNativeToolCallingConfig(providerInfo, true)
			result.should.be.false("Bedrock + Claude 3.x should NOT use native tool calling")
		})

		it("should not use native tool calling when the setting is disabled", () => {
			const { isNativeToolCallingConfig } = require("@utils/model-utils")

			const claude4Options: AwsBedrockHandlerOptions = {
				...mockOptions,
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			}
			const handler = new AwsBedrockHandler(claude4Options)
			const model = handler.getModel()
			const providerInfo = {
				providerId: "bedrock",
				model: { id: model.id, info: model.info },
			}

			const result = isNativeToolCallingConfig(providerInfo, false)
			result.should.be.false("Native tool calling should be disabled when setting is off")
		})

		it("should pass toolConfig to ConverseStreamCommand when tools are provided", async () => {
			const handler = new AwsBedrockHandler(mockOptions)

			// Capture the command passed to executeConverseStream
			let capturedCommand: any = null
			const originalExecuteConverseStream = handler["executeConverseStream"].bind(handler)
			handler["executeConverseStream"] = async function* (command: any, modelInfo: any) {
				capturedCommand = command
				// Yield nothing — we just want to capture the command
			}

			const tools = [
				{
					name: "read_file",
					description: "Read a file",
					input_schema: {
						type: "object" as const,
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			]

			// Consume the generator to trigger createAnthropicMessage
			const gen = handler["createAnthropicMessage"]("system prompt", [], "test-model", handler.getModel(), false, tools)
			for await (const _ of gen) {
				// drain
			}

			// Verify the command includes toolConfig
			should.exist(capturedCommand, "ConverseStreamCommand should have been created")
			const input = capturedCommand.input
			should.exist(input.toolConfig, "toolConfig should be present in the command")
			input.toolConfig.tools.should.have.length(1)
			input.toolConfig.tools[0].toolSpec.name.should.equal("read_file")
		})

		it("should format a complete tool call round-trip correctly", () => {
			// Simulates the full cycle: model returns tool_use → Cline executes → sends tool_result back
			const handler = new AwsBedrockHandler(mockOptions)

			// Turn 1: assistant calls a tool
			// Turn 2: user sends tool result
			// Turn 3: assistant calls another tool (proves multi-turn works)
			// Turn 4: user sends second tool result
			const conversation: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read the file." },
						{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "a.ts" } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call-1", content: "export const a = 1" }],
				},
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-2", name: "read_file", input: { path: "b.ts" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call-2", content: "export const b = 2", is_error: false }],
				},
			]

			const formatted = handler["formatMessagesForConverseAPI"](conversation)

			// Turn 1: text + toolUse
			formatted[0].content?.should.have.length(2)
			formatted[0].content?.[0]?.text?.should.equal("I'll read the file.")
			formatted[0].content?.[1]?.toolUse?.toolUseId?.should.equal("call-1")
			formatted[0].content?.[1]?.toolUse?.name?.should.equal("read_file")

			// Turn 2: toolResult
			formatted[1].content?.[0]?.toolResult?.toolUseId?.should.equal("call-1")
			formatted[1].content?.[0]?.toolResult?.status?.should.equal("success")

			// Turn 3: toolUse
			formatted[2].content?.[0]?.toolUse?.toolUseId?.should.equal("call-2")

			// Turn 4: toolResult
			formatted[3].content?.[0]?.toolResult?.toolUseId?.should.equal("call-2")
		})
	})
})
