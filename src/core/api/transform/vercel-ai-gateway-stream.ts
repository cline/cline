import { Anthropic } from "@anthropic-ai/sdk"
import {
	CLAUDE_SONNET_1M_SUFFIX,
	ModelInfo,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getOpenAIToolParams } from "./tool-call-processor"

export async function createVercelAIGatewayStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	thinkingBudgetTokens?: number,
	tools?: OpenAITool[],
) {
	// Convert Anthropic messages to OpenAI format
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	const isClaudeSonnet1m = model.id === openRouterClaudeSonnet41mModelId || model.id === openRouterClaudeSonnet451mModelId
	if (isClaudeSonnet1m) {
		// remove the custom :1m suffix, to create the model id openrouter API expects
		model.id = model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
	}

	const isAnthropicModel = model.id.startsWith("anthropic/")
	const isMinimaxModel = model.id.startsWith("minimax/")

	if (isAnthropicModel || isMinimaxModel) {
		openAiMessages[0] = {
			role: "system",
			content: systemPrompt,
			// @ts-ignore-next-line
			cache_control: { type: "ephemeral" },
		}

		// Add cache_control to the last two user messages for conversation context caching
		const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
		lastTwoUserMessages.forEach((msg) => {
			if (typeof msg.content === "string" && msg.content.length > 0) {
				msg.content = [{ type: "text", text: msg.content }]
			}
			if (Array.isArray(msg.content)) {
				// Find the last text part in the message content
				const lastTextPart = msg.content.filter((part) => part.type === "text").pop()

				if (lastTextPart && lastTextPart.text && lastTextPart.text.length > 0) {
					// @ts-ignore-next-line
					lastTextPart["cache_control"] = { type: "ephemeral" }
				}
			}
		})
	}

	// Configure reasoning parameters similar to OpenRouter
	let temperature: number | undefined = 0
	let reasoning: { max_tokens: number } | undefined

	if (isAnthropicModel) {
		const budget_tokens = thinkingBudgetTokens || 0
		const reasoningOn = budget_tokens !== 0
		if (reasoningOn) {
			temperature = undefined // extended thinking does not support non-1 temperature
			reasoning = { max_tokens: budget_tokens }
		}
	} else if (thinkingBudgetTokens && model.info?.thinkingConfig && thinkingBudgetTokens > 0) {
		temperature = undefined // extended thinking does not support non-1 temperature
		reasoning = { max_tokens: thinkingBudgetTokens }
	}

	// @ts-ignore-next-line
	const stream = await client.chat.completions.create({
		model: model.id,
		max_tokens: model.info.maxTokens,
		temperature: temperature,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		include_reasoning: true,
		...(reasoning ? { reasoning } : {}),
		...getOpenAIToolParams(tools),
	})

	return stream
}
