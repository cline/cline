/**
 * Vertex Handler
 *
 * Routes Vertex models by family:
 * - Gemini models -> Google GenAI Vertex path via GeminiHandler
 * - Claude models -> AI SDK Google Vertex Anthropic provider
 */

import { toAiSdkMessages } from "../transform/ai-sdk-community-format";
import {
	convertToAnthropicMessages,
	convertToolsToAnthropic,
} from "../transform/anthropic-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	hasModelCapability,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import {
	emitAiSdkStream,
	loadAiSdkModule,
	numberOrZero,
} from "./ai-sdk-community";
import { resolveHandlerModel } from "./ai-sdk-provider-base";
import { BaseHandler } from "./base";
import { GeminiHandler } from "./gemini-base";

const DEFAULT_VERTEX_REGION = "us-central1";

function isClaudeModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("claude");
}

type VertexAnthropicModule = {
	createVertexAnthropic: (options?: {
		project?: string;
		location?: string;
		headers?: Record<string, string | undefined>;
		baseURL?: string;
	}) => (modelId: string) => unknown;
};

function toAiSdkTools(
	tools: ToolDefinition[] | undefined,
): Record<string, unknown> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const anthropicTools = convertToolsToAnthropic(tools);
	return Object.fromEntries(
		anthropicTools.map((tool) => [
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.input_schema,
			},
		]),
	);
}

function toVertexClaudeMessages(
	systemPrompt: string,
	messages: Message[],
	options?: { promptCacheOn?: boolean },
) {
	const systemContent = options?.promptCacheOn
		? [
				{
					type: "text",
					text: systemPrompt,
					providerOptions: {
						anthropic: { cacheControl: { type: "ephemeral" } },
					},
				},
			]
		: systemPrompt;
	return toAiSdkMessages(systemContent, messages, {
		assistantToolCallArgKey: "input",
	});
}

/**
 * Handler for Vertex AI that supports both Gemini and Claude models.
 */
export class VertexHandler extends BaseHandler {
	readonly type = "vertex";
	private geminiHandler: GeminiHandler | undefined;
	private vertexAnthropicModelFactory:
		| ((modelId: string) => unknown)
		| undefined;
	private vertexAnthropicModelFactoryPromise:
		| Promise<(modelId: string) => unknown>
		| undefined;

	private getProjectId(): string {
		const projectId = this.config.gcp?.projectId?.trim();
		if (!projectId) {
			throw new Error(
				"Vertex provider requires `gcp.projectId` in provider configuration.",
			);
		}
		return projectId;
	}

	private getConfiguredRegion(): string | undefined {
		return this.config.gcp?.region?.trim() || this.config.region?.trim();
	}

	private getRequiredClaudeRegion(): string {
		const region = this.getConfiguredRegion();
		if (!region) {
			throw new Error(
				"Vertex Claude models require `gcp.region` (or `region`) in provider configuration.",
			);
		}
		return region;
	}

	private getGeminiRegion(): string {
		return this.getConfiguredRegion() ?? DEFAULT_VERTEX_REGION;
	}

	private ensureGeminiHandler(): GeminiHandler {
		if (!this.geminiHandler) {
			const projectId = this.getProjectId();
			const region = this.getGeminiRegion();
			this.geminiHandler = new GeminiHandler({
				...this.config,
				region,
				gcp: {
					...this.config.gcp,
					projectId,
					region,
				},
			});
		}
		return this.geminiHandler;
	}

	private async ensureVertexAnthropicModelFactory(): Promise<
		(modelId: string) => unknown
	> {
		if (this.vertexAnthropicModelFactory) {
			return this.vertexAnthropicModelFactory;
		}
		if (!this.vertexAnthropicModelFactoryPromise) {
			this.vertexAnthropicModelFactoryPromise = import(
				"@ai-sdk/google-vertex/anthropic"
			).then((module) => {
				const provider = (
					module as VertexAnthropicModule
				).createVertexAnthropic({
					project: this.getProjectId(),
					location: this.getRequiredClaudeRegion(),
					headers: this.getRequestHeaders(),
					baseURL: this.config.baseUrl,
				});
				const modelFactory = (modelId: string) => provider(modelId);
				this.vertexAnthropicModelFactory = modelFactory;
				return modelFactory;
			});
		}
		try {
			return await this.vertexAnthropicModelFactoryPromise;
		} catch (error) {
			this.vertexAnthropicModelFactoryPromise = undefined;
			if (
				error instanceof Error &&
				error.message.includes("@ai-sdk/google-vertex")
			) {
				throw new Error(
					'Vertex Claude models require @ai-sdk/google-vertex at runtime. Install workspace dependencies before using provider "vertex".',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	getModel(): HandlerModelInfo {
		return resolveHandlerModel(this.config);
	}

	getMessages(systemPrompt: string, messages: Message[]): unknown {
		const model = this.getModel();
		if (!isClaudeModel(model.id)) {
			return this.ensureGeminiHandler().getMessages(systemPrompt, messages);
		}
		const supportsPromptCache = this.supportsPromptCache(model.info);
		return convertToAnthropicMessages(messages, supportsPromptCache);
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		yield* retryStream(() =>
			this.createMessageInternal(systemPrompt, messages, tools),
		);
	}

	private async *createMessageInternal(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const model = this.getModel();

		if (!isClaudeModel(model.id)) {
			yield* this.ensureGeminiHandler().createMessage(
				systemPrompt,
				messages,
				tools,
			);
			return;
		}

		const ai = await loadAiSdkModule();
		const modelFactory = await this.ensureVertexAnthropicModelFactory();
		const responseId = this.createResponseId();

		const budgetTokens = this.config.thinkingBudgetTokens ?? 0;
		const reasoningOn =
			hasModelCapability(model.info, "reasoning") && budgetTokens > 0;
		const promptCacheOn = this.supportsPromptCache(model.info);

		const providerOptions: Record<string, unknown> = {};
		if (reasoningOn) {
			providerOptions.anthropic = {
				thinking: { type: "enabled", budgetTokens },
			};
		}

		const stream = ai.streamText({
			model: modelFactory(model.id),
			messages: toVertexClaudeMessages(systemPrompt, messages, {
				promptCacheOn,
			}),
			tools: toAiSdkTools(tools),
			maxTokens: model.info.maxTokens ?? this.config.maxOutputTokens ?? 128_000,
			temperature: reasoningOn ? undefined : 0,
			providerOptions:
				Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
			abortSignal: this.getAbortSignal(),
		});

		yield* emitAiSdkStream(stream, {
			responseId,
			errorMessage: "Vertex Anthropic stream failed",
			calculateCost: (
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
			) =>
				this.calculateCost(
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
				),
			reasoningTypes: ["reasoning-delta"],
			enableToolCalls: true,
			toolCallArgsOrder: ["input", "args"],
			toolCallFunctionIncludeId: true,
			resolveUsageMetrics: (usage, part) => {
				const providerMetadata = (part?.providerMetadata ?? {}) as Record<
					string,
					unknown
				>;
				const anthropicMetadata =
					(providerMetadata.anthropic as Record<string, unknown> | undefined) ??
					{};

				return {
					inputTokens: numberOrZero(usage.inputTokens),
					outputTokens: numberOrZero(usage.outputTokens),
					thoughtsTokenCount: numberOrZero(
						usage.reasoningTokens ?? usage.thoughtsTokenCount,
					),
					cacheReadTokens: numberOrZero(
						usage.cachedInputTokens ?? anthropicMetadata.cacheReadInputTokens,
					),
					cacheWriteTokens: numberOrZero(
						anthropicMetadata.cacheCreationInputTokens,
					),
				};
			},
		});
	}
}
