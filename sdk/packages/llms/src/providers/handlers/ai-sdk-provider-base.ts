import { toAiSdkMessages } from "../transform/ai-sdk-community-format";
import type { ApiStream, HandlerModelInfo, ProviderConfig } from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import {
	type EmitAiSdkStreamOptions,
	emitAiSdkStream,
	type LoadAiSdkOptions,
	loadAiSdkModule,
} from "./ai-sdk-community";
import { BaseHandler } from "./base";

type AiSdkCommunityProvider = (
	modelId: string,
	settings?: Record<string, unknown>,
) => unknown;

type ProviderModule = Record<string, unknown>;

const providerModuleCache = new Map<string, ProviderModule>();

type CommunityProviderDefinition = {
	moduleName: string;
	createExportName: string;
	providerExportName: string;
	missingDependencyError: string;
};

export function resolveHandlerModel(
	config: ProviderConfig,
	defaultModelId?: string,
): HandlerModelInfo {
	const configuredModelId = config.modelId?.trim();
	const modelId =
		configuredModelId && configuredModelId.length > 0
			? configuredModelId
			: (defaultModelId ?? "");
	const knownModels = config.knownModels ?? {};
	const fallbackModel = knownModels[modelId] ?? {};
	const modelInfo = config.modelInfo ?? fallbackModel;
	return { id: modelId, info: { ...modelInfo, id: modelId } };
}

async function loadProviderModule(moduleName: string): Promise<ProviderModule> {
	const cached = providerModuleCache.get(moduleName);
	if (cached) {
		return cached;
	}
	const loaded = (await import(moduleName)) as ProviderModule;
	providerModuleCache.set(moduleName, loaded);
	return loaded;
}

export abstract class AiSdkProviderHandler extends BaseHandler {
	readonly type = "ai-sdk-community";
	private provider: AiSdkCommunityProvider | undefined;
	private providerPromise: Promise<AiSdkCommunityProvider> | undefined;

	protected abstract getProviderDefinition(): CommunityProviderDefinition;
	protected abstract getDefaultModelId(): string;

	protected getProviderCreateOptions(): Record<string, unknown> | undefined {
		return undefined;
	}

	protected async beforeLoadProviderModule(): Promise<void> {}

	protected getProviderModelSettings(): Record<string, unknown> | undefined {
		return undefined;
	}

	protected getLoadAiSdkOptions(): LoadAiSdkOptions | undefined {
		return undefined;
	}

	protected getStreamErrorMessage(): string {
		return "AI SDK stream failed";
	}

	protected getEmitStreamOptions(): Omit<
		EmitAiSdkStreamOptions,
		"responseId" | "errorMessage" | "calculateCost"
	> {
		return {};
	}

	protected getAssistantToolCallArgKey(): "args" | "input" {
		return "input";
	}

	protected normalizeModelId(modelId: string): string {
		return modelId;
	}

	protected async ensureProvider(): Promise<AiSdkCommunityProvider> {
		if (this.provider) {
			return this.provider;
		}
		if (!this.providerPromise) {
			this.providerPromise = (async () => {
				const definition = this.getProviderDefinition();
				await this.beforeLoadProviderModule();
				const module = await loadProviderModule(definition.moduleName);

				const createProvider = module[definition.createExportName] as
					| ((options?: Record<string, unknown>) => AiSdkCommunityProvider)
					| undefined;
				const provider = module[definition.providerExportName] as
					| AiSdkCommunityProvider
					| undefined;

				if (createProvider) {
					const created = createProvider(this.getProviderCreateOptions());
					this.provider = created;
					return created;
				}

				if (provider) {
					this.provider = provider;
					return provider;
				}

				throw new Error(
					`${definition.moduleName} did not export \`${definition.providerExportName}\` or \`${definition.createExportName}\`.`,
				);
			})();
		}

		try {
			return await this.providerPromise;
		} catch (error) {
			this.providerPromise = undefined;
			const moduleName = this.getProviderDefinition().moduleName;
			if (error instanceof Error && error.message.includes(moduleName)) {
				throw new Error(this.getProviderDefinition().missingDependencyError, {
					cause: error,
				});
			}
			throw error;
		}
	}

	getModel(): HandlerModelInfo {
		return resolveHandlerModel(this.config, this.getDefaultModelId());
	}

	getMessages(systemPrompt: string, messages: Message[]) {
		return toAiSdkMessages(systemPrompt, messages, {
			assistantToolCallArgKey: this.getAssistantToolCallArgKey(),
		});
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
		void tools;

		const ai = await loadAiSdkModule(this.getLoadAiSdkOptions());
		const provider = await this.ensureProvider();
		const { id: modelId, info } = this.getModel();
		const responseId = this.createResponseId();

		const stream = ai.streamText({
			model: provider(
				this.normalizeModelId(modelId),
				this.getProviderModelSettings(),
			),
			messages: this.getMessages(systemPrompt, messages),
			maxTokens: info.maxTokens ?? undefined,
			temperature: info.temperature ?? undefined,
			abortSignal: this.getAbortSignal(),
		});

		yield* emitAiSdkStream(stream, {
			responseId,
			errorMessage: this.getStreamErrorMessage(),
			calculateCost: (
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
			) =>
				this.calculateCostFromInclusiveInput(
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
				),
			...this.getEmitStreamOptions(),
		});
	}
}
