import { Anthropic } from "@anthropic-ai/sdk"
import {
	CLAUDE_SONNET_1M_SUFFIX,
	ModelInfo,
	OPENROUTER_PROVIDER_PREFERENCES,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
} from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
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
	geminiThinkingLevel?: string,
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

	// Gemini models require thought signatures for tool calls. When switching providers mid-conversation,
	// historical tool calls may not include Gemini/OpenRouter reasoning details, which can poison the next request.
	// Bandaid: for Gemini only, drop tool_calls that lack reasoning_details and their paired tool messages.
	if (model.id.includes("gemini")) {
		const droppedToolCallIds = new Set<string>()
		const sanitized: OpenAI.Chat.ChatCompletionMessageParam[] = []

		for (const msg of openAiMessages) {
			if (msg.role === "assistant") {
				const anyMsg = msg as any
				const toolCalls = anyMsg.tool_calls
				if (Array.isArray(toolCalls) && toolCalls.length > 0) {
					const reasoningDetails = anyMsg.reasoning_details
					const hasReasoningDetails = Array.isArray(reasoningDetails) && reasoningDetails.length > 0
					if (!hasReasoningDetails) {
						for (const tc of toolCalls) {
							if (tc?.id) droppedToolCallIds.add(tc.id)
						}
						// Keep any textual content, but drop the tool_calls themselves.
						if (anyMsg.content) {
							sanitized.push({ role: "assistant", content: anyMsg.content } as any)
						}
						continue
					}
				}
			}

			if (msg.role === "tool") {
				const anyMsg = msg as any
				if (anyMsg.tool_call_id && droppedToolCallIds.has(anyMsg.tool_call_id)) {
					continue
				}
			}

			sanitized.push(msg)
		}

		openAiMessages = sanitized
	}

	// prompt caching: https://openrouter.ai/docs/prompt-caching
	// this was initially specifically for claude models (some models may 'support prompt caching' automatically without this)
	// handles direct model.id match logic
	switch (model.id) {
		case "anthropic/claude-haiku-4.5":
		case "anthropic/claude-4.5-haiku":
		case "anthropic/claude-sonnet-4.5":
		case "anthropic/claude-4.5-sonnet": // OpenRouter accidentally included this in model list for a brief moment, and users may be using this model id. And to support prompt caching, we need to add it here.
		case "anthropic/claude-sonnet-4":
		case "anthropic/claude-opus-4.5":
		case "anthropic/claude-opus-4.1":
		case "anthropic/claude-opus-4":
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
		case "minimax/minimax-m2":
		case "minimax/minimax-m2.1":
		case "minimax/minimax-m2.1-lightning":
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
		case "anthropic/claude-haiku-4.5":
		case "anthropic/claude-4.5-haiku":
		case "anthropic/claude-sonnet-4.5":
		case "anthropic/claude-4.5-sonnet":
		case "anthropic/claude-sonnet-4":
		case "anthropic/claude-opus-4.5":
		case "anthropic/claude-opus-4.1":
		case "anthropic/claude-opus-4":
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
	if (model.id.startsWith("google/gemini-3.0") || model.id === "google/gemini-3.0") {
		// Recommended value from google
		temperature = 1.0
	}

	let reasoning: { max_tokens: number } | undefined
	switch (model.id) {
		case "anthropic/claude-haiku-4.5":
		case "anthropic/claude-4.5-haiku":
		case "anthropic/claude-sonnet-4.5":
		case "anthropic/claude-4.5-sonnet":
		case "anthropic/claude-sonnet-4":
		case "anthropic/claude-opus-4.5":
		case "anthropic/claude-opus-4.1":
		case "anthropic/claude-opus-4":
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
			const budget_tokens = thinkingBudgetTokens || 0
			const reasoningOn = budget_tokens !== 0
			if (reasoningOn) {
				temperature = undefined // extended thinking does not support non-1 temperature
				reasoning = { max_tokens: budget_tokens }
			}
			break
		default:
			if (
				thinkingBudgetTokens &&
				model.info?.thinkingConfig &&
				thinkingBudgetTokens > 0 &&
				!(model.id.includes("gemini") && geminiThinkingLevel)
			) {
				temperature = undefined // extended thinking does not support non-1 temperature
				reasoning = { max_tokens: thinkingBudgetTokens }
				break
			}
	}

	const providerPreferences = OPENROUTER_PROVIDER_PREFERENCES[model.id]
	if (providerPreferences) {
		openRouterProviderSorting = undefined
	}

	// Skip reasoning for models that don't support it (e.g., devstral, grok-4)
	const includeReasoning = !shouldSkipReasoningForModel(model.id)

	// @ts-ignore-next-line
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
		...(openRouterProviderSorting && !providerPreferences ? { provider: { sort: openRouterProviderSorting } } : {}),
		...(providerPreferences ? { provider: providerPreferences } : {}),
		...(isClaudeSonnet1m ? { provider: { order: ["anthropic", "google-vertex/global"], allow_fallbacks: false } } : {}),
		...getOpenAIToolParams(tools),
		...(model.id.includes("gemini") && geminiThinkingLevel
			? { thinking_config: { thinking_level: geminiThinkingLevel, include_thoughts: true } }
			: {}),
	})

	return stream
}
