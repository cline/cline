/**
 * Gemini Base Handler
 *
 * Handler for Google's Gemini API using the official SDK.
 * Supports Vertex AI, thinking/reasoning, and native tool calling.
 */

import {
	FunctionCallingConfigMode,
	type GenerateContentConfig,
	GoogleGenAI,
	ThinkingLevel,
} from "@google/genai";
import {
	convertToGeminiMessages,
	convertToolsToGemini,
} from "../transform/gemini-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	type ProviderConfig,
	supportsModelThinking,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { RetriableError, retryStream } from "../utils/retry";
import { BaseHandler } from "./base";

const DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 128_000;
const GEMINI_3_FLASH_MAX_OUTPUT_TOKENS = 8192;

function isGemini3Model(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes("gemini-3");
}

function isGemini3FlashModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return (
		isGemini3Model(modelId) &&
		normalized.includes("flash") &&
		!normalized.includes("lite")
	);
}

/**
 * Handler for Google's Gemini API
 */
export class GeminiHandler extends BaseHandler {
	private client: GoogleGenAI | undefined;

	private ensureClient(): GoogleGenAI {
		if (!this.client) {
			// Check for Vertex AI configuration
			if (this.config.gcp?.projectId) {
				this.client = new GoogleGenAI({
					vertexai: true,
					project: this.config.gcp.projectId,
					location: this.config.region ?? "us-central1",
					httpOptions: {
						headers: this.getRequestHeaders(),
					},
				});
			} else {
				// Standard API key auth
				if (!this.config.apiKey) {
					throw new Error(
						"Gemini API key is required when not using Vertex AI",
					);
				}

				this.client = new GoogleGenAI({
					apiKey: this.config.apiKey,
					httpOptions: {
						headers: this.getRequestHeaders(),
					},
				});
			}
		}
		return this.client;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		const knownModels = this.config.knownModels ?? {};
		const fallbackModel = knownModels[modelId] ?? {};
		const modelInfo = this.config.modelInfo ?? fallbackModel;

		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	getMessages(_systemPrompt: string, messages: Message[]) {
		return convertToGeminiMessages(messages);
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		yield* retryStream(
			() => this.createMessageInternal(systemPrompt, messages, tools),
			{ maxRetries: 4, baseDelay: 2000, maxDelay: 15000 },
		);
	}

	private async *createMessageInternal(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const client = this.ensureClient();
		const { id: modelId, info } = this.getModel();
		const abortSignal = this.getAbortSignal();
		const responseId = this.createResponseId();

		// Convert messages
		const contents = this.getMessages(systemPrompt, messages);

		const thinkingSupported = supportsModelThinking(info);
		const thinkingRequested =
			this.config.thinking === true ||
			typeof this.config.thinkingBudgetTokens === "number" ||
			typeof this.config.reasoningEffort === "string";
		let thinkingBudget = 0;
		let thinkingLevel: ThinkingLevel | undefined;
		const usesThinkingLevel =
			info.thinkingConfig?.thinkingLevel != null || isGemini3Model(modelId);

		if (thinkingSupported && thinkingRequested) {
			const requestedBudget =
				this.config.thinkingBudgetTokens ??
				(thinkingRequested ? DEFAULT_THINKING_BUDGET_TOKENS : 0);
			thinkingBudget = Math.min(
				Math.max(0, requestedBudget),
				info.thinkingConfig?.maxBudget ?? 24576,
			);

			if (usesThinkingLevel) {
				const level = this.config.reasoningEffort;
				if (level === "high" || level === "xhigh") {
					thinkingLevel = ThinkingLevel.HIGH;
				} else if (level === "medium") {
					thinkingLevel = ThinkingLevel.MEDIUM;
				} else if (level === "low") {
					thinkingLevel = ThinkingLevel.LOW;
				} else if (this.config.thinking) {
					thinkingLevel = ThinkingLevel.MEDIUM;
				}
			}
		}

		// Build request config with abort signal
		const fallbackMaxOutputTokens = isGemini3FlashModel(modelId)
			? GEMINI_3_FLASH_MAX_OUTPUT_TOKENS
			: DEFAULT_MAX_OUTPUT_TOKENS;
		const maxOutputTokens =
			info.maxTokens ?? this.config.maxOutputTokens ?? fallbackMaxOutputTokens;
		const requestConfig: GenerateContentConfig = {
			httpOptions: this.config.baseUrl
				? { baseUrl: this.config.baseUrl, headers: this.getRequestHeaders() }
				: undefined,
			abortSignal,
			systemInstruction: systemPrompt,
			temperature: info.temperature ?? 1,
			maxOutputTokens,
		};

		// Add thinking config only when explicitly requested and supported.
		if (
			thinkingSupported &&
			thinkingRequested &&
			(usesThinkingLevel || thinkingBudget > 0)
		) {
			requestConfig.thinkingConfig = {
				thinkingBudget: usesThinkingLevel ? undefined : thinkingBudget,
				thinkingLevel,
				includeThoughts: true,
			};
		}

		// Add tools if provided
		if (tools && tools.length > 0) {
			const functionDeclarations = convertToolsToGemini(tools);
			requestConfig.tools = [{ functionDeclarations }];
			requestConfig.toolConfig = {
				functionCallingConfig: {
					mode: FunctionCallingConfigMode.AUTO,
				},
			};
		}

		try {
			const result = await client.models.generateContentStream({
				model: modelId,
				contents,
				config: requestConfig,
			});

			let promptTokens = 0;
			let outputTokens = 0;
			let cacheReadTokens = 0;
			let thoughtsTokenCount = 0;
			let syntheticToolCallIndex = 0;

			for await (const chunk of result) {
				// Handle content parts
				const parts = chunk?.candidates?.[0]?.content?.parts ?? [];

				for (const part of parts) {
					if (part.thought && part.text) {
						// Thinking content
						yield {
							type: "reasoning",
							reasoning: part.text || "",
							signature: part.thoughtSignature,
							id: responseId,
						};
					} else if (part.text) {
						// Regular text
						yield {
							type: "text",
							text: part.text,
							id: responseId,
							signature: part.thoughtSignature,
						};
					}

					if (part.functionCall) {
						// Tool call
						const functionCall = part.functionCall;
						const callId =
							functionCall.id ??
							`${responseId}_tool_${syntheticToolCallIndex++}`;
						if (functionCall.name) {
							yield {
								type: "tool_calls",
								tool_call: {
									call_id: callId,
									function: {
										id: callId,
										name: functionCall.name,
										arguments:
											(functionCall.args as Record<string, unknown>) ?? {},
									},
								},
								id: responseId,
								signature: part.thoughtSignature,
							};
						}
					}
				}

				// Track usage
				if (chunk.usageMetadata) {
					promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
					outputTokens =
						chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
					thoughtsTokenCount =
						chunk.usageMetadata.thoughtsTokenCount ?? thoughtsTokenCount;
					cacheReadTokens =
						chunk.usageMetadata.cachedContentTokenCount ?? cacheReadTokens;
				}
			}

			// Yield final usage
			const totalCost = this.calculateGeminiCost(
				promptTokens,
				outputTokens,
				thoughtsTokenCount,
				cacheReadTokens,
			);

			yield {
				type: "usage",
				inputTokens: promptTokens,
				outputTokens,
				thoughtsTokenCount,
				cacheReadTokens,
				cacheWriteTokens: 0,
				totalCost,
				id: responseId,
			};

			// Yield done chunk to indicate streaming completed successfully
			yield { type: "done", success: true, id: responseId };
		} catch (error) {
			// Handle rate limit errors with retry info
			if (error instanceof Error && error.message.includes("429")) {
				throw new RetriableError(error.message, undefined, { cause: error });
			}
			throw error;
		}
	}

	private calculateGeminiCost(
		inputTokens: number,
		outputTokens: number,
		thoughtsTokenCount: number,
		cacheReadTokens: number,
	): number | undefined {
		return this.calculateCost(
			inputTokens,
			outputTokens + thoughtsTokenCount,
			cacheReadTokens,
		);
	}
}

/**
 * Create a Gemini handler
 */
export function createGeminiHandler(config: ProviderConfig): GeminiHandler {
	return new GeminiHandler(config);
}
