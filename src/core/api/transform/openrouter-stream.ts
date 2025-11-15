import { Anthropic } from "@anthropic-ai/sdk"
import {
	CLAUDE_SONNET_1M_SUFFIX,
	ModelInfo,
	OPENROUTER_PROVIDER_PREFERENCES,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
} from "@shared/api"
import OpenAI from "openai"
import { ChatCompletionTool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages } from "./openai-format"
import { convertToR1Format } from "./r1-format"
import { getOpenAIToolParams } from "./tool-call-processor"

export async function createOpenRouterStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	openRouterProviderSorting?: string,
	tools?: Array<ChatCompletionTool>,
) {
	// Convert Anthropic messages to OpenAI format
	let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	const isClaudeSonnet1m = model.id === openRouterClaudeSonnet41mModelId || model.id === openRouterClaudeSonnet451mModelId
	if (isClaudeSonnet1m) {
		// remove the custom :1m suffix, to create the model id openrouter API expects
		model.id = model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
	}

	const isAnthropicModel = model.id.startsWith("anthropic/")

	// prompt caching: https://openrouter.ai/docs/prompt-caching

	if (isAnthropicModel) {
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
	}

	// The anthropic api requires this value and since they offer both 4096 and 8192 variants, we should ensure 8192.
	// (models usually default to max tokens allowed)
	let maxTokens: number | undefined
	if (isAnthropicModel) {
		maxTokens = 8_192
	}

	let temperature: number | undefined = 0
	let topP: number | undefined
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

	let reasoning: { max_tokens: number } | undefined
	if (isAnthropicModel) {
		const budget_tokens = thinkingBudgetTokens || 0
		const reasoningOn = budget_tokens !== 0
		if (reasoningOn) {
			temperature = undefined // extended thinking does not support non-1 temperature
			reasoning = { max_tokens: budget_tokens }
		}
	} else {
		if (thinkingBudgetTokens && model.info?.thinkingConfig && thinkingBudgetTokens > 0) {
			temperature = undefined // extended thinking does not support non-1 temperature
			reasoning = { max_tokens: thinkingBudgetTokens }
		}
	}

	const providerPreferences = OPENROUTER_PROVIDER_PREFERENCES[model.id]
	if (providerPreferences) {
		openRouterProviderSorting = undefined
	}

	// @ts-ignore-next-line
	const stream = await client.chat.completions.create({
		model: model.id,
		max_tokens: maxTokens,
		temperature: temperature,
		top_p: topP,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		include_reasoning: true,
		...(model.id.startsWith("openai/o") ? { reasoning_effort: reasoningEffort || "medium" } : {}),
		...(reasoning ? { reasoning } : {}),
		...(openRouterProviderSorting && !providerPreferences ? { provider: { sort: openRouterProviderSorting } } : {}),
		...(providerPreferences ? { provider: providerPreferences } : {}),
		...getOpenAIToolParams(tools),
	})

	return stream
}
