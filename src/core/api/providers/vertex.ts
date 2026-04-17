import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { FunctionDeclaration as GoogleTool } from "@google/genai"
import {
	ApiHandlerModel,
	ApiHandlerOptions,
	vertexDefaultModelId,
	vertexModels,
} from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { sanitizeAnthropicMessages } from "../utils/messages_api_support"
import { GeminiHandler } from "./gemini"
import { ApiHandler } from "../index"

/**
 * VertexHandler manages requests to Google Cloud Vertex AI.
 * 
 * Verified against April 17, 2026 Platform Specifications:
 * - Supports Claude 4.7 Task Budgets (output_config.task_budget).
 * - Implements Gemma 4 MaaS Thinking (chat_template_kwargs).
 * - Enforces mandatory 'anthropic_version' inside the request body.
 * - Handles 'reasoning_content' for Google-native models.
 */
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private geminiHandler?: GeminiHandler

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	private ensureGeminiHandler(): GeminiHandler {
		if (!this.geminiHandler) {
			this.geminiHandler = new GeminiHandler(this.options)
		}
		return this.geminiHandler
	}

	private ensureAnthropicClient(): AnthropicVertex {
		return new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			region: this.options.vertexRegion,
		})
	}

	private parseModelId(rawId: string) {
		return {
			cleanId: rawId.replace(/(:1m|:fast|:customtools|:thinking)$/g, ""),
			is1m: rawId.includes(":1m"),
			isCustomTools: rawId.includes(":customtools")
		}
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[]) {
		const { id: rawModelId, info: modelInfo } = this.getModel()
		const { cleanId: modelId, is1m, isCustomTools } = this.parseModelId(rawModelId)

		// Delegate to GeminiHandler for Google-native families (except MaaS).
		if (!rawModelId.includes("claude") && !rawModelId.includes("gemma")) {
			const geminiHandler = this.ensureGeminiHandler()
			yield* geminiHandler.createMessage(systemPrompt, messages, tools as GoogleTool[])
			return
		}

		const clientAnthropic = this.ensureAnthropicClient()
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = (modelInfo.supportsReasoning ?? false) && budgetTokens !== 0

		// Claude 4.5+ Adaptive Thinking resolution.
		const isAdaptiveModel = isClaudeOpusAdaptiveThinkingModel(modelId)
		const adaptive = isAdaptiveModel
			? resolveClaudeOpusAdaptiveThinking(this.options.reasoningEffort, budgetTokens)
			: undefined
		
		const thinkingEnabled = isAdaptiveModel ? adaptive?.enabled : reasoningOn
		
		const thinkingConfig = thinkingEnabled
			? isAdaptiveModel
				? { type: "adaptive" }
				: { type: "enabled", budget_tokens: budgetTokens }
			: undefined
		
		const outputConfig: any = {}
		if (isAdaptiveModel && adaptive?.effort) {
			outputConfig.effort = adaptive.effort
		}

		// Implement Task Budgets for Opus 4.7 (Soft Cap logic)
		if (modelId.includes("opus-4-7") && thinkingEnabled) {
			outputConfig.task_budget = {
				type: "tokens",
				total: Math.max(budgetTokens, 20000)
			}
		}

		const nativeToolsOn = !!tools?.length
		const anthropicMessages = sanitizeAnthropicMessages(messages, modelInfo.supportsPromptCache ?? false)

		/**
		 * WHY: Vertex AI requires the version string INSIDE the body for 2026 models.
		 * Additionally, sampling parameters MUST be deleted for reasoning requests.
		 */
		const requestBody: any = {
			anthropic_version: "vertex-2023-10-16",
			model: modelId,
			max_tokens: modelInfo.maxTokens || 8192,
			thinking: thinkingConfig,
			system: [
				{
					text: systemPrompt || "You are a helpful AI assistant.",
					type: "text",
					cache_control: modelInfo.supportsPromptCache ? { type: "ephemeral" } : undefined,
				},
			],
			messages: anthropicMessages,
			stream: true,
			tools: nativeToolsOn ? (tools as AnthropicTool[]) : undefined,
			tool_choice: nativeToolsOn && (thinkingEnabled || isCustomTools) ? { type: "auto" } : { type: "any" },
		}

		// Gemma 4 MaaS specific 'Thinking' activation
		if (rawModelId.includes("gemma-4") && thinkingEnabled) {
			requestBody.chat_template_kwargs = { enable_thinking: true }
		}

		if (!thinkingEnabled && !modelInfo.thinkingConfig?.requiresStrictSchema) {
			requestBody.temperature = 0
		} else {
			delete requestBody.temperature
			delete requestBody.top_p
			delete requestBody.top_k
		}

		if (Object.keys(outputConfig).length > 0) {
			requestBody.output_config = outputConfig
		}

		const betaHeaders: string[] = []
		if (is1m) betaHeaders.push("context-1m-2025-08-07")
		if (thinkingEnabled) {
			betaHeaders.push("adaptive-thinking-2026-04-17")
			if (outputConfig.task_budget) betaHeaders.push("task-budgets-2026-03-13")
		}

		const stream = (await clientAnthropic.beta.messages.create(
			requestBody,
			betaHeaders.length > 0
				? { headers: { "anthropic-beta": betaHeaders.join(",") } }
				: undefined,
		)) as any

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "content_block_start":
					if (chunk.content_block.type === "text") {
						yield { type: "text", text: chunk.content_block.text }
					} else if (chunk.content_block.type === "thinking") {
						yield { type: "thought", text: chunk.content_block.thinking }
					}
					break
				case "content_block_delta":
					if (chunk.delta.type === "text_delta") {
						yield { type: "text", text: chunk.delta.text }
					} else if (chunk.delta.type === "thinking_delta") {
						yield { type: "thought", text: chunk.delta.thinking }
					}
					break
				case "message_delta":
					yield {
						type: "usage",
						inputTokens: chunk.usage.input_tokens || 0,
						outputTokens: chunk.usage.output_tokens || 0,
						cacheWriteTokens: chunk.usage.cache_creation_input_tokens || 0,
						cacheReadTokens: chunk.usage.cache_read_input_tokens || 0
					}
					break
			}
		}
	}

	getModel(): ApiHandlerModel {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as keyof typeof vertexModels
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
