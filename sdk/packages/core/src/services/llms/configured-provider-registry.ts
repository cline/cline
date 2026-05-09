import type { ProviderConfig } from "./provider-settings";
import type {
	BuiltInProviderSummary,
	CreateHandlerInput,
	ProviderConfigDefaults,
	ProviderSelectionConfig,
	RegisteredProviderSummary,
} from "./runtime-types";

interface ConfiguredProviderRecord {
	id: string;
	models: Set<string>;
	defaultModel: string;
	defaults: ProviderConfigDefaults;
}

interface RegisterConfiguredProviderInput {
	id: string;
	models: readonly string[];
	defaultModel?: string;
	defaults?: ProviderConfigDefaults;
}

function cloneDefaults(
	defaults: ProviderConfigDefaults | undefined,
): ProviderConfigDefaults {
	return defaults ? { ...defaults } : {};
}

function resolveApiKey(
	apiKey?: string,
	apiKeyEnv?: string,
): string | undefined {
	if (apiKey) {
		return apiKey;
	}
	if (!apiKeyEnv) {
		return undefined;
	}
	const runtimeProcess = globalThis.process;
	if (!runtimeProcess?.env) {
		return undefined;
	}
	return runtimeProcess.env[apiKeyEnv];
}

function assertNonEmptyModels(
	providerId: string,
	models: readonly string[],
): void {
	if (!models.length) {
		throw new Error(
			`Provider "${providerId}" must include at least one model.`,
		);
	}
}

export function toBuiltInProviderSummary(input: {
	collection: BuiltInProviderSummary["id"] extends string
		? {
				provider: Pick<
					import("@clinebot/llms").ProviderInfo,
					| "id"
					| "name"
					| "description"
					| "protocol"
					| "baseUrl"
					| "capabilities"
					| "env"
					| "defaultModelId"
				>;
				models: Record<string, unknown>;
			}
		: never;
}): BuiltInProviderSummary {
	const models = Object.keys(input.collection.models);
	return {
		id: input.collection.provider.id,
		name: input.collection.provider.name,
		description: input.collection.provider.description,
		protocol: input.collection.provider.protocol,
		baseUrl: input.collection.provider.baseUrl,
		capabilities: input.collection.provider.capabilities,
		env: input.collection.provider.env,
		models,
		defaultModel: input.collection.provider.defaultModelId,
		modelCount: models.length,
	};
}

export class ConfiguredProviderRegistry {
	private readonly providers = new Map<string, ConfiguredProviderRecord>();

	register(input: RegisterConfiguredProviderInput): void {
		assertNonEmptyModels(input.id, input.models);
		const defaultModel = input.defaultModel ?? input.models[0];
		if (!defaultModel) {
			throw new Error(`Provider "${input.id}" must define a default model.`);
		}
		if (!input.models.includes(defaultModel)) {
			throw new Error(
				`Default model "${defaultModel}" is not included in configured models for "${input.id}".`,
			);
		}
		const existing = this.providers.get(input.id);
		this.providers.set(input.id, {
			id: input.id,
			models: new Set([...(existing?.models ?? []), ...input.models]),
			defaultModel,
			defaults: {
				...(existing?.defaults ?? {}),
				...cloneDefaults(input.defaults),
			},
		});
	}

	registerSelectionConfig(provider: ProviderSelectionConfig): void {
		this.register({
			id: provider.id,
			models: provider.models,
			defaultModel: provider.defaultModel,
			defaults: {
				apiKey: resolveApiKey(provider.apiKey, provider.apiKeyEnv),
				routingProviderId: provider.builtinProviderId,
				baseUrl: provider.baseUrl,
				headers: provider.headers,
				timeoutMs: provider.timeoutMs,
				capabilities: provider.capabilities,
				...cloneDefaults(provider.settings),
			},
		});
	}

	registerModel(providerId: string, modelId: string): void {
		const existing = this.providers.get(providerId);
		if (!existing) {
			this.providers.set(providerId, {
				id: providerId,
				models: new Set([modelId]),
				defaultModel: modelId,
				defaults: {},
			});
			return;
		}
		existing.models.add(modelId);
	}

	createHandlerConfig(input: CreateHandlerInput): ProviderConfig {
		const provider = this.require(input.providerId);
		const modelId = input.modelId ?? provider.defaultModel;
		if (!provider.models.has(modelId)) {
			throw new Error(
				`Model "${modelId}" is not configured for provider "${input.providerId}".`,
			);
		}
		return {
			providerId: input.providerId,
			modelId,
			...provider.defaults,
			...input.overrides,
		};
	}

	list(): RegisteredProviderSummary[] {
		return Array.from(this.providers.values()).map((provider) => ({
			id: provider.id,
			models: Array.from(provider.models),
			defaultModel: provider.defaultModel,
		}));
	}

	getModels(providerId: string): string[] {
		return Array.from(this.require(providerId).models);
	}

	hasProvider(providerId: string): boolean {
		return this.providers.has(providerId);
	}

	hasModel(providerId: string, modelId: string): boolean {
		return this.providers.get(providerId)?.models.has(modelId) ?? false;
	}

	private require(providerId: string): ConfiguredProviderRecord {
		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new Error(
				`Provider "${providerId}" is not configured in this SDK instance.`,
			);
		}
		return provider;
	}
}
