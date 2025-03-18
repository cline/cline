import { ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "./openai-format"
import { convertToR1Format } from "./r1-format"
import { ApiStream, ApiStreamChunk } from "./stream"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { OpenRouterErrorResponse } from "../providers/types"

/**
 * Creates a stream for generating content via OpenRouter-compatible APIs.
 * Handles diverse model-specific requirements including:
 * - Format conversion between Anthropic and OpenAI message formats
 * - Prompt caching for Claude models
 * - Max token settings for various model types
 * - Temperature and top_p adjustments for specific models
 * - Reasoning/thinking configuration for supported models
 * - Context window management with middle-out transformation
 *
 * This function serves as a shared utility for both OpenRouter and Cline handlers.
 *
 * @param client - An OpenAI-compatible client configured for the target API
 * @param systemPrompt - Instructions to guide the model's behavior
 * @param messages - Array of messages in Anthropic format
 * @param model - Object containing model ID and information
 * @param o3MiniReasoningEffort - Optional reasoning effort setting for o3-mini model ("low"|"medium"|"high")
 * @param thinkingBudgetTokens - Optional token budget for Claude 3.7 extended thinking
 * @returns A stream of completion chunks compatible with OpenRouter's response format
 * @see https://openrouter.ai/docs
 */
export async function createOpenRouterStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	o3MiniReasoningEffort?: string,
	thinkingBudgetTokens?: number,
) {
	// Convert Anthropic messages to OpenAI format
	let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	// prompt caching: https://openrouter.ai/docs/prompt-caching
	// this is specifically for claude models (some models may 'support prompt caching' automatically without this)
	switch (model.id) {
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
		case "anthropic/claude-3.5-sonnet":
		case "anthropic/claude-3.5-sonnet:beta":
		case "anthropic/claude-3.5-sonnet-20240620":
		case "anthropic/claude-3.5-sonnet-20240620:beta":
		case "anthropic/claude-3-5-haiku":
		case "anthropic/claude-3-5-haiku:beta":
		case "anthropic/claude-3-5-haiku-20241022":
		case "anthropic/claude-3-5-haiku-20241022:beta":
		case "anthropic/claude-3-haiku":
		case "anthropic/claude-3-haiku:beta":
		case "anthropic/claude-3-opus":
		case "anthropic/claude-3-opus:beta":
			// Apply cache_control for system prompt
			openAiMessages[0] = {
				role: "system",
				content: [
					{
						type: "text",
						text: systemPrompt,
						// @ts-ignore-next-line
						cache_control: { type: "ephemeral" },
					},
				],
			}
			// Add cache_control to the last two user messages
			// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
			const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
			lastTwoUserMessages.forEach((msg) => {
				if (typeof msg.content === "string") {
					msg.content = [{ type: "text", text: msg.content }]
				}
				if (Array.isArray(msg.content)) {
					// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
					let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

					if (!lastTextPart) {
						lastTextPart = { type: "text", text: "..." }
						msg.content.push(lastTextPart)
					}
					// @ts-ignore-next-line
					lastTextPart["cache_control"] = { type: "ephemeral" }
				}
			})
			break
		default:
			break
	}

	// Not sure how openrouter defaults max tokens when no value is provided, but the anthropic api requires this value and since they offer both 4096 and 8192 variants, we should ensure 8192.
	// (models usually default to max tokens allowed)
	let maxTokens: number | undefined
	switch (model.id) {
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
		case "anthropic/claude-3.5-sonnet":
		case "anthropic/claude-3.5-sonnet:beta":
		case "anthropic/claude-3.5-sonnet-20240620":
		case "anthropic/claude-3.5-sonnet-20240620:beta":
		case "anthropic/claude-3-5-haiku":
		case "anthropic/claude-3-5-haiku:beta":
		case "anthropic/claude-3-5-haiku-20241022":
		case "anthropic/claude-3-5-haiku-20241022:beta":
			maxTokens = 8_192
			break
	}

	// Set temperature and topP for specific models
	let temperature: number | undefined = 0
	let topP: number | undefined = undefined
	if (
		model.id.startsWith("deepseek/deepseek-r1") ||
		model.id === "perplexity/sonar-reasoning" ||
		model.id === "qwen/qwq-32b:free" ||
		model.id === "qwen/qwq-32b"
	) {
		// Recommended values from DeepSeek
		temperature = 0.7
		topP = 0.95
		openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
	}

	// Configure extended reasoning/thinking for Claude 3.7 models
	let reasoning: { max_tokens: number } | undefined = undefined
	switch (model.id) {
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
			let budget_tokens = thinkingBudgetTokens || 0
			const reasoningOn = budget_tokens !== 0 ? true : false
			if (reasoningOn) {
				temperature = undefined // extended thinking does not support non-1 temperature
				reasoning = { max_tokens: budget_tokens }
			}
			break
	}

	// Determine whether to apply middle-out transformation for context window management
	// Removes messages in the middle when close to context window limit. Should not be applied to models that support prompt caching since it would continuously break the cache.
	let shouldApplyMiddleOutTransform = !model.info.supportsPromptCache
	// except for deepseek (which we set supportsPromptCache to true for), where because the context window is so small our truncation algo might miss and we should use openrouter's middle-out transform as a fallback to ensure we don't exceed the context window (FIXME: once we have a more robust token estimator we should not rely on this)
	if (model.id === "deepseek/deepseek-chat") {
		shouldApplyMiddleOutTransform = true
	}

	// Create and return the completion stream
	// @ts-ignore-next-line
	const stream = await client.chat.completions.create({
		model: model.id,
		max_tokens: maxTokens,
		temperature: temperature,
		top_p: topP,
		messages: openAiMessages,
		stream: true,
		transforms: shouldApplyMiddleOutTransform ? ["middle-out"] : undefined,
		include_reasoning: true,
		...(model.id === "openai/o3-mini" ? { reasoning_effort: o3MiniReasoningEffort || "medium" } : {}),
		...(reasoning ? { reasoning } : {}),
	})

	return stream
}
