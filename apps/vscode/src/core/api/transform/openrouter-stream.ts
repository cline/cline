import { Anthropic } from "@anthropic-ai/sdk"
import {
	CLAUDE_SONNET_1M_SUFFIX,
	ModelInfo,
	OPENROUTER_PROVIDER_PREFERENCES,
	openRouterClaudeOpus461mModelId,
	openRouterClaudeOpus471mModelId,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
	openRouterClaudeSonnet461mModelId,
} from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import {
	GEMINI_FLASH_MAX_OUTPUT_TOKENS,
	isGeminiFlashModel,
	shouldSkipReasoningForModel,
	supportsReasoningEffortForModel,
} from "@utils/model-utils"
import OpenAI from "openai"
import { ChatCompletionTool } from "openai/resources/chat/completions"
import { convertToOpenAiMessages, sanitizeGeminiMessages } from "./openai-format"
import { convertToR1Format } from "./r1-format"
import { getOpenAIToolParams } from "./tool-call-processor"

const openRouterExplicitCacheControlModelIds = new Set([
	"deepseek/deepseek-v3.2",
	"qwen/qwen-plus",
	"qwen/qwen3-max",
	"qwen/qwen3.6-plus",
	"qwen/qwen3-coder-plus",
	"qwen/qwen3-coder-flash",
])

function needsExplicitCacheControl(modelId: string): boolean {
	return (
		modelId.startsWith("anthropic/") || modelId.startsWith("minimax/") || openRouterExplicitCacheControlModelIds.has(modelId)
	)
}

export async function createOpenRouterStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	openRouterProviderSorting?: string,
	tools?: Array<ChatCompletionTool>,
	enableParallelToolCalling?: boolean,
) {
	// Convert Anthropic messages to OpenAI format
	let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	const isClaude1m =
		model.id === openRouterClaudeSonnet41mModelId ||
		model.id === openRouterClaudeSonnet451mModelId ||
		model.id === openRouterClaudeSonnet461mModelId ||
		model.id === openRouterClaudeOpus461mModelId ||
		model.id === openRouterClaudeOpus471mModelId
	if (isClaude1m) {
		// remove the custom :1m suffix, to create the model id openrouter API expects
		model.id = model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
	}

	// Sanitize messages for Gemini models (removes tool_calls without reasoning_details)
	openAiMessages = sanitizeGeminiMessages(openAiMessages, model.id)

	// prompt caching: https://openrouter.ai/docs/prompt-caching
	// Some OpenRouter models require cache_control blocks instead of automatic provider caching.
	// Other providers (OpenAI, Google) handle caching automatically without cache_control blocks.
	const needsCacheControl = needsExplicitCacheControl(model.id)

	if (needsCacheControl) {
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
	if (model.id.startsWith("google/gemini-3")) {
		// Recommended value from google
		temperature = 1.0
	}

	const supportsReasoningEffort = supportsReasoningEffortForModel(model.id)

	// Claude Opus 4.5+ uses adaptive thinking instead of budgeted extended thinking.
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(model.id)
	const adaptiveThinking = isAdaptiveThinkingModel
		? resolveClaudeOpusAdaptiveThinking(reasoningEffort, thinkingBudgetTokens)
		: undefined
	if (isAdaptiveThinkingModel) {
		temperature = undefined
		topP = undefined
	}

	let reasoning: Record<string, unknown> | undefined
	if (!isAdaptiveThinkingModel) {
		switch (model.id) {
			case "anthropic/claude-haiku-4.5":
			case "anthropic/claude-4.5-haiku":
			case "anthropic/claude-sonnet-4.6":
			case "anthropic/claude-4.6-sonnet":
			case "anthropic/claude-sonnet-4.5":
			case "anthropic/claude-4.5-sonnet":
			case "anthropic/claude-sonnet-4":
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
				if (thinkingBudgetTokens && model.info?.thinkingConfig && thinkingBudgetTokens > 0 && !supportsReasoningEffort) {
					temperature = undefined // extended thinking does not support non-1 temperature
					reasoning = { max_tokens: thinkingBudgetTokens }
					break
				}
		}
	}

	const providerPreferences = OPENROUTER_PROVIDER_PREFERENCES[model.id]
	if (providerPreferences) {
		openRouterProviderSorting = undefined
	}

	const normalizedReasoningEffort = reasoningEffort !== undefined ? normalizeOpenaiReasoningEffort(reasoningEffort) : undefined
	const reasoningEffortValue = supportsReasoningEffort ? normalizedReasoningEffort : undefined
	// Skip reasoning for models that don't support it (e.g., devstral, grok-4), or when effort explicitly disables it.
	const includeReasoning = isAdaptiveThinkingModel
		? !!adaptiveThinking?.enabled
		: !shouldSkipReasoningForModel(model.id) && reasoningEffortValue !== "none"
	const reasoningPayload = isAdaptiveThinkingModel
		? adaptiveThinking?.enabled
			? { enabled: true }
			: undefined
		: (reasoning ?? (reasoningEffortValue && reasoningEffortValue !== "none" ? { effort: reasoningEffortValue } : undefined))
	const maxTokens = isGeminiFlashModel(model.id)
		? Math.min(model.info.maxTokens || GEMINI_FLASH_MAX_OUTPUT_TOKENS, GEMINI_FLASH_MAX_OUTPUT_TOKENS)
		: undefined

	const requestPayload: Record<string, unknown> = {
		model: model.id,
		...(maxTokens ? { max_tokens: maxTokens } : {}),
		temperature: temperature,
		top_p: topP,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		include_reasoning: includeReasoning,
		...(reasoningPayload ? { reasoning: reasoningPayload } : {}),
		...(isAdaptiveThinkingModel && adaptiveThinking?.effort ? { verbosity: adaptiveThinking.effort } : {}),
		...(openRouterProviderSorting && !providerPreferences ? { provider: { sort: openRouterProviderSorting } } : {}),
		...(providerPreferences ? { provider: providerPreferences } : {}),
		...(isClaude1m ? { provider: { order: ["anthropic", "google-vertex/global"], allow_fallbacks: false } } : {}),
		...getOpenAIToolParams(tools, !!enableParallelToolCalling),
	}

	// @ts-expect-error-next-line
	const stream = await client.chat.completions.create(requestPayload)

	return stream
}
