import { Anthropic } from "@anthropic-ai/sdk"
import {
	CLAUDE_SONNET_1M_SUFFIX,
	ModelInfo,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
} from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages, sanitizeGeminiMessages } from "../transform/openai-format"
import { convertToR1Format } from "./r1-format"
import { getOpenAIToolParams } from "./tool-call-processor"

export async function createVercelAIGatewayStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	tools?: OpenAITool[],
	geminiThinkingLevel?: string,
) {
	// Convert Anthropic messages to OpenAI format
	let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	const isClaudeSonnet1m = model.id === openRouterClaudeSonnet41mModelId || model.id === openRouterClaudeSonnet451mModelId
	if (isClaudeSonnet1m) {
		// remove the custom :1m suffix, to create the model id the API expects
		model.id = model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
	}

	// Sanitize messages for Gemini models (removes tool_calls without reasoning_details)
	openAiMessages = sanitizeGeminiMessages(openAiMessages, model.id)

	// Prompt caching for supported models
	// This handles cache_control for Claude and MiniMax models
	const isAnthropicModel = model.id.startsWith("anthropic/")
	const isMinimaxModel = model.id.startsWith("minimax/")

	if (isAnthropicModel || isMinimaxModel) {
		openAiMessages[0] = {
			role: "system",
			content: [
				{
					type: "text",
					text: systemPrompt,
					// @ts-expect-error-next-line
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
				// @ts-expect-error-next-line
				lastTextPart["cache_control"] = { type: "ephemeral" }
			}
		})
	}

	// Use max tokens from model info (fetched from Vercel API)
	const maxTokens = model.info?.maxTokens || undefined

	// Use temperature from model info, default to 0
	// Model-specific temperatures are derived in refreshVercelAiGatewayModels.ts
	let temperature: number | undefined = model.info?.temperature ?? 0
	let topP: number | undefined

	// R1 format conversion for DeepSeek and similar reasoning models
	const requiresR1Format =
		model.id.startsWith("deepseek/deepseek-r1") ||
		model.id === "perplexity/sonar-reasoning" ||
		model.id === "qwen/qwq-32b:free" ||
		model.id === "qwen/qwq-32b"

	if (requiresR1Format) {
		topP = 0.95
		openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
	}
	if (model.id.startsWith("google/gemini-3.0") || model.id === "google/gemini-3.0") {
		// Recommended value from google
		temperature = 1.0
	}

	// Reasoning/thinking budget configuration
	let reasoning: { max_tokens: number } | undefined

	// Check if it's an Anthropic Claude model that supports thinking
	const isClaudeThinkingModel = model.id.startsWith("anthropic/claude") && model.info?.thinkingConfig

	if (isClaudeThinkingModel) {
		// For Claude models, match OpenRouter behavior: check even if thinkingBudgetTokens is 0
		const budgetTokens = thinkingBudgetTokens || 0
		if (budgetTokens !== 0) {
			temperature = undefined // extended thinking does not support non-1 temperature
			reasoning = { max_tokens: budgetTokens }
		}
	} else if (
		thinkingBudgetTokens &&
		thinkingBudgetTokens > 0 &&
		model.info?.thinkingConfig &&
		!(model.id.includes("gemini-3") && geminiThinkingLevel)
	) {
		// For other models with thinkingConfig, use the standard check
		temperature = undefined // extended thinking does not support non-1 temperature
		reasoning = { max_tokens: thinkingBudgetTokens }
	}

	// Skip reasoning for models that don't support it (e.g., devstral, grok-4)
	const includeReasoning = !shouldSkipReasoningForModel(model.id)

	// @ts-expect-error-next-line
	const stream = await client.chat.completions.create({
		model: model.id,
		max_tokens: maxTokens,
		temperature: temperature,
		top_p: topP,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		include_reasoning: includeReasoning,
		...(model.id.startsWith("openai/o") ? { reasoning_effort: reasoningEffort || "medium" } : {}),
		...(reasoning ? { reasoning } : {}),
		...getOpenAIToolParams(tools),
		...(model.id.includes("gemini-3") && geminiThinkingLevel
			? { thinking_config: { thinking_level: geminiThinkingLevel, include_thoughts: true } }
			: {}),
	})

	return stream
}
