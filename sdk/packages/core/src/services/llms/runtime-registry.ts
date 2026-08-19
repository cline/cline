import type { ApiHandler } from "@cline/llms";
import {
	BUILT_IN_PROVIDER_IDS,
	createHandler as createProviderHandler,
	createHandlerAsync as createProviderHandlerAsync,
	getProviderCollection,
	hasProvider,
	registerAsyncHandler,
	registerHandler,
	registerModel as registerModelInCatalog,
	registerProvider as registerProviderInCatalog,
} from "@cline/llms";
import {
	ConfiguredProviderRegistry,
	toBuiltInProviderSummary,
} from "./configured-provider-registry";
import type {
	BuiltInProviderSummary,
	CreateHandlerInput,
	LlmsConfig,
	LlmsSdk,
	RegisterBuiltinProviderInput,
	RegisteredProviderSummary,
	RegisterModelInput,
	RegisterProviderInput,
} from "./runtime-types";

export class DefaultLlmsSdk implements LlmsSdk {
	private readonly configuredProviders = new ConfiguredProviderRegistry();

	constructor(config: LlmsConfig) {
		this.applyConfig(config);
	}

	createHandler(input: CreateHandlerInput): ApiHandler {
		return createProviderHandler(
			this.configuredProviders.createHandlerConfig(input),
		);
	}

	async createHandlerAsync(input: CreateHandlerInput): Promise<ApiHandler> {
		return createProviderHandlerAsync(
			this.configuredProviders.createHandlerConfig(input),
		);
	}

	registerProvider(input: RegisterProviderInput): void {
		registerProviderInCatalog(input.collection);
		if (input.handlerFactory && input.asyncHandlerFactory) {
			throw new Error(
				`Provider "${input.collection.provider.id}" cannot register both sync and async handlers.`,
			);
		}
		if (input.handlerFactory) {
			registerHandler(input.collection.provider.id, input.handlerFactory);
		}
		if (input.asyncHandlerFactory) {
			registerAsyncHandler(
				input.collection.provider.id,
				input.asyncHandlerFactory,
			);
		}
		this.configuredProviders.register({
			id: input.collection.provider.id,
			models: input.exposeModels ?? Object.keys(input.collection.models),
			defaultModel:
				input.defaultModel ?? input.collection.provider.defaultModelId,
			defaults: input.defaults,
		});
	}

	registerBuiltinProvider(input: RegisterBuiltinProviderInput): void {
		const exposedModels = input.exposeModels ?? Object.keys(input.models);
		const defaultModel = input.defaultModel ?? exposedModels[0];
		if (!defaultModel) {
			throw new Error(`Provider "${input.id}" must define a default model.`);
		}
		registerProviderInCatalog({
			provider: {
				id: input.id,
				name: input.name ?? input.id,
				description: input.description,
				protocol: input.protocol,
				baseUrl: input.baseUrl,
				defaultModelId: defaultModel,
				client: input.client ?? "openai-compatible",
				capabilities: input.capabilities,
				env: input.env,
				source: "system",
			},
			models: input.models,
		});
		this.configuredProviders.register({
			id: input.id,
			models: exposedModels,
			defaultModel,
			defaults: {
				routingProviderId: input.builtinProviderId,
				...(input.defaults ?? {}),
			},
		});
	}

	registerModel(input: RegisterModelInput): void {
		registerModelInCatalog(input.providerId, input.modelId, input.info);
		this.configuredProviders.registerModel(input.providerId, input.modelId);
	}

	getProviders(): RegisteredProviderSummary[] {
		return this.configuredProviders.list();
	}

	getBuiltInProviderIds() {
		return [...BUILT_IN_PROVIDER_IDS];
	}

	async getBuiltInProviders(): Promise<BuiltInProviderSummary[]> {
		const collections = await Promise.all(
			BUILT_IN_PROVIDER_IDS.map((providerId: string) =>
				getProviderCollection(providerId),
			),
		);
		return collections
			.filter(
				(collection): collection is NonNullable<typeof collection> =>
					collection !== undefined,
			)
			.map((collection) => toBuiltInProviderSummary({ collection }));
	}

	getModels(providerId: string): string[] {
		return this.configuredProviders.getModels(providerId);
	}

	isProviderConfigured(providerId: string): boolean {
		return this.configuredProviders.hasProvider(providerId);
	}

	isModelConfigured(providerId: string, modelId: string): boolean {
		return this.configuredProviders.hasModel(providerId, modelId);
	}

	private applyConfig(config: LlmsConfig): void {
		for (const provider of config.providers) {
			this.configuredProviders.registerSelectionConfig(provider);
		}
		for (const model of config.models ?? []) {
			this.registerModel(model);
		}
		for (const provider of config.customProviders ?? []) {
			this.registerProvider(provider);
		}
		for (const provider of this.configuredProviders.list()) {
			const providerExists = hasProvider(provider.id);
			const routedProviderId = this.configuredProviders.createHandlerConfig({
				providerId: provider.id,
				modelId: provider.defaultModel,
			}).routingProviderId;
			const routedProviderExists =
				typeof routedProviderId === "string" && hasProvider(routedProviderId);
			if (!providerExists && !routedProviderExists) {
				throw new Error(
					`Provider "${provider.id}" is not known. Register it through customProviders/registerProvider, registerBuiltinProvider, or use a built-in provider ID.`,
				);
			}
		}
	}
}

export function createLlmsSdk(config: LlmsConfig): LlmsSdk {
	return new DefaultLlmsSdk(config);
}
