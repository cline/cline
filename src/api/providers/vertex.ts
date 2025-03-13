import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { VertexAI } from "@google-cloud/vertexai"

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private clientAnthropic: AnthropicVertex
	private clientVertex: VertexAI
	private thinkingStartTime?: number
	private totalThinkingTokens: number = 0
	private accumulatedThinking: string = ''

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.clientAnthropic = new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
			region: this.options.vertexRegion,
		})
		this.clientVertex = new VertexAI({
			project: this.options.vertexProjectId,
			location: this.options.vertexRegion,
		})
	}

	// Simple token estimation function using consistent 4:1 character to token ratio
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		if (modelId.includes("claude")) {
			// Simply use the user-specified budget without complexity assessment
			let budget_tokens = this.options.thinkingBudgetTokens || 0;
			
			// Minimum threshold to avoid enabling thinking for trivial tasks
			const MIN_THINKING_THRESHOLD = 1024; // Minimum 1k tokens to enable thinking
			
			// Check if the model is Claude 3.7 and budget is sufficient
			const reasoningOn = modelId.includes("claude-3-7") && budget_tokens >= MIN_THINKING_THRESHOLD ? true : false;
			
			// Cap the budget at 60k to ensure max_tokens can be higher
			if (budget_tokens > 60000) {
				budget_tokens = 60000;
			}

			console.log(`[Vertex] Extended thinking: ${reasoningOn ? 'ENABLED' : 'DISABLED'}`);
			console.log(`[Vertex] Model: ${modelId}, Budget: ${budget_tokens} tokens`);

			let stream
			switch (modelId) {
				case "claude-3-7-sonnet@20250219":
				case "claude-3-5-sonnet-v2@20241022":
				case "claude-3-5-sonnet@20240620":
				case "claude-3-5-haiku@20241022":
				case "claude-3-opus@20240229":
				case "claude-3-haiku@20240307": {
					// Find indices of user messages for cache control
					const userMsgIndices = messages.reduce(
						(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
						[] as number[],
					)
					const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
					const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

					// Configure thinking with user's budget
					let thinkingConfig: any = reasoningOn ? { 
						type: "enabled", 
						budget_tokens: Math.min(budget_tokens, model.info.maxTokens || 64000)
					} : undefined;
					
					// No enhancement to system prompt
					const enhancedSystemPrompt = systemPrompt;

					stream = await this.clientAnthropic.beta.messages.create(
						{
							model: modelId,
							// Ensure max_tokens is greater than thinking.budget_tokens when thinking is enabled
							max_tokens: reasoningOn 
								? budget_tokens < 60000 
									? Math.min(budget_tokens + 4000, model.info.maxTokens || 64000)
									: 64000 // For very large budgets, set max_tokens to max allowed
								: (model.info.maxTokens || 8192),
							thinking: thinkingConfig,
							temperature: reasoningOn ? 1 : 0, // Must be set to 1 when thinking is enabled
							system: [
								{
									text: enhancedSystemPrompt,
									type: "text",
									cache_control: { type: "ephemeral" },
								},
							],
							messages: messages.map((message, index) => {
								if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
									return {
										...message,
										content:
											typeof message.content === "string"
												? [
														{
															type: "text",
															text: message.content,
															cache_control: {
																type: "ephemeral",
															},
														},
													]
												: message.content.map((content, contentIndex) =>
														contentIndex === message.content.length - 1
															? {
																	...content,
																	cache_control: {
																		type: "ephemeral",
																	},
																}
															: content,
													),
									}
								}
								return {
									...message,
									content:
										typeof message.content === "string"
											? [
													{
														type: "text",
														text: message.content,
													},
												]
											: message.content,
								}
							}),
							stream: true,
						},
						{
							headers: {},
						},
					)
					break
				}
				default: {
					stream = await this.clientAnthropic.beta.messages.create({
						model: modelId,
						max_tokens: model.info.maxTokens || 8192,
						temperature: 0,
						system: [
							{
								text: systemPrompt,
								type: "text",
							},
						],
						messages: messages.map((message) => ({
							...message,
							content:
								typeof message.content === "string"
									? [
											{
												type: "text",
												text: message.content,
											},
										]
									: message.content,
						})),
						stream: true,
					})
					break
				}
			}
			for await (const chunk of stream) {
				switch (chunk.type) {
					case "message_start":
						const usage = chunk.message.usage
						yield {
							type: "usage",
							inputTokens: usage.input_tokens || 0,
							outputTokens: usage.output_tokens || 0,
							cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
							cacheReadTokens: usage.cache_read_input_tokens || undefined,
						}
						break
					case "message_delta":
						yield {
							type: "usage",
							inputTokens: 0,
							outputTokens: chunk.usage.output_tokens || 0,
						}
						break
					case "message_stop":
						break
					case "content_block_start":
						switch (chunk.content_block.type) {
						case "thinking":
{
    const currentTime = Date.now();
    // Store the thinking start time for later calculation
    this.thinkingStartTime = currentTime;
    // Reset total thinking tokens for this response
    this.totalThinkingTokens = 0;
    // Initialize accumulated thinking content
    this.accumulatedThinking = "";

    // Get the thinking content
    const thinkingContent = chunk.content_block.thinking || "";
    // Add to accumulated thinking content
    this.accumulatedThinking += thinkingContent;

    // Simple token estimation using 4:1 ratio
    const estimatedTokens = this.estimateTokens(thinkingContent);
    
    // Add to total thinking tokens
    this.totalThinkingTokens += estimatedTokens;
    
    // Basic logging
    console.log(`[Vertex] Initial thinking block: ~${estimatedTokens} tokens (${thinkingContent.length} chars)`);

yield {
        type: "reasoning",
        reasoning: thinkingContent,
        thinkingStartTime: currentTime,
        thinkingTokens: estimatedTokens > 0 ? estimatedTokens : 0
    }
}
break
							case "redacted_thinking":
								// Handle redacted thinking blocks - we still mark it as reasoning
								// but note that the content is encrypted
								yield {
									type: "reasoning",
									reasoning: "[Redacted thinking block]",
									thinkingTokens: 1 // Placeholder token count for redacted content
								}
								break
							case "text":
								// Mark end of thinking when text block starts
								const currentEndTime = Date.now();
								
								// Basic logging when thinking completes
								if (this.totalThinkingTokens > 0) {
									console.log(`[Vertex] Thinking complete: ~${this.totalThinkingTokens} tokens used`);
									console.log(`[Vertex] Thinking budget utilization: ${((this.totalThinkingTokens / (this.options.thinkingBudgetTokens || 1)) * 100).toFixed(2)}%`);
								}
								
								// Send a final reasoning message with the total token count
								yield {
									type: "reasoning",
									reasoning: "",
									thinkingEndTime: currentEndTime,
									thinkingTokens: this.totalThinkingTokens
								}
								
								if (chunk.index > 0) {
									yield {
										type: "text",
										text: "\n",
									}
								}
								yield {
									type: "text",
									text: chunk.content_block.text,
								}
								break
						}
						break
					case "content_block_delta":
						switch (chunk.delta.type) {
							case "thinking_delta":
								// For thinking deltas, use the same simple estimation
								const deltaContent = chunk.delta.thinking || "";
								
								// Add to accumulated thinking content
								this.accumulatedThinking += deltaContent;
								
								// Simple token estimation using 4:1 ratio
								const estimatedTokens = this.estimateTokens(deltaContent);
								
								// Add to total thinking tokens
								this.totalThinkingTokens += estimatedTokens;
								
								// Basic logging for significant deltas
								if (estimatedTokens > 20) {
									console.log(`[Vertex] Thinking delta: ~${estimatedTokens} tokens (${deltaContent.length} chars)`);
								}
								
								yield {
									type: "reasoning",
									reasoning: deltaContent,
									thinkingTokens: this.totalThinkingTokens
								}
								break
							case "text_delta":
								yield {
									type: "text",
									text: chunk.delta.text,
								}
								break
							case "signature_delta":
								// We don't need to do anything with the signature in the client
								// It's used when sending the thinking block back to the API
								break
						}
						break
					case "content_block_stop":
						break
				}
			}
		} else {
			// gemini
			const generativeModel = this.clientVertex.getGenerativeModel({
				model: this.getModel().id,
				systemInstruction: {
					role: "system",
					parts: [{ text: systemPrompt }],
				},
			})
			const request = {
				contents: [
					{
						role: "user",
						parts: messages.map((m) => {
							if (typeof m.content === "string") {
								return { text: m.content }
							} else if (Array.isArray(m.content)) {
								return {
									text: m.content
										.map((block) => {
											if (typeof block === "string") {
												return block
											} else if (block.type === "text") {
												return block.text
											} else {
												console.log("Unsupported block type", block)
												return ""
											}
										})
										.join(" "),
								}
							} else {
								return { text: "" }
							}
						}),
					},
				],
			}
			const streamingResult = await generativeModel.generateContentStream(request)
			for await (const chunk of streamingResult.stream) {
				// If usage data is available, yield it similarly:
				// yield { type: "usage", inputTokens: 0, outputTokens: 0 }
				// Otherwise, just yield text:
				const candidates = chunk.candidates || []
				for (const candidate of candidates) {
					for (const part of candidate.content?.parts || []) {
						if (part.text) {
							yield {
								type: "text",
								text: part.text,
							}
						}
					}
				}
			}
		}
	}

	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
