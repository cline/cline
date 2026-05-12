import type {
	GatewayModelDefinition,
	GatewayModelSelection,
	GatewayProviderConfig,
	GatewayProviderFactory,
	GatewayProviderManifest,
	GatewayProviderRegistration,
	GatewayResolvedModel,
	GatewayResolvedProviderConfig,
} from "@cline/shared";

interface ProviderRecord {
	manifest: GatewayProviderManifest;
	defaults?: GatewayResolvedProviderConfig;
	createProvider?: GatewayProviderFactory;
	loadProvider?: GatewayProviderRegistration["loadProvider"];
}

interface ProviderConfigRecord extends GatewayResolvedProviderConfig {
	enabled: boolean;
	defaultModelId?: string;
	models?: readonly Omit<GatewayModelDefinition, "providerId">[];
}

function cloneManifest(
	manifest: GatewayProviderManifest,
): GatewayProviderManifest {
	return {
		...manifest,
		models: manifest.models.map((model) => ({ ...model })),
		capabilities: manifest.capabilities
			? [...manifest.capabilities]
			: undefined,
		env: manifest.env ? [...manifest.env] : undefined,
		api: manifest.api,
		apiKeyEnv: manifest.apiKeyEnv ? [...manifest.apiKeyEnv] : undefined,
		docsUrl: manifest.docsUrl,
		metadata: manifest.metadata ? { ...manifest.metadata } : undefined,
	};
}

function mergeModels(
	manifest: GatewayProviderManifest,
	config: ProviderConfigRecord | undefined,
): readonly GatewayModelDefinition[] {
	const merged = new Map<string, GatewayModelDefinition>();

	for (const model of manifest.models) {
		merged.set(model.id, { ...model });
	}

	for (const model of config?.models ?? []) {
		merged.set(model.id, {
			...model,
			providerId: manifest.id,
		});
	}

	return Array.from(merged.values());
}

function createUnregisteredModel(
	provider: GatewayProviderManifest,
	modelId: string,
): GatewayModelDefinition {
	return {
		id: modelId,
		name: modelId,
		providerId: provider.id,
	};
}

export class GatewayRegistry {
	private readonly providers = new Map<string, ProviderRecord>();
	private readonly providerConfigs = new Map<string, ProviderConfigRecord>();
	private readonly fallbackFetch?: typeof fetch;

	constructor(fetchImpl?: typeof fetch) {
		this.fallbackFetch = fetchImpl;
	}

	registerProvider(registration: GatewayProviderRegistration): void {
		if (!registration.createProvider && !registration.loadProvider) {
			throw new Error(
				`Provider "${registration.manifest.id}" must include createProvider or loadProvider.`,
			);
		}

		this.providers.set(registration.manifest.id, {
			manifest: cloneManifest(registration.manifest),
			defaults: registration.defaults
				? {
						providerId: registration.manifest.id,
						apiKey: registration.defaults.apiKey,
						apiKeyResolver: registration.defaults.apiKeyResolver,
						apiKeyEnv: registration.defaults.apiKeyEnv,
						baseUrl: registration.defaults.baseUrl,
						headers: registration.defaults.headers
							? { ...registration.defaults.headers }
							: undefined,
						timeoutMs: registration.defaults.timeoutMs,
						fetch: registration.defaults.fetch,
						options: registration.defaults.options
							? { ...registration.defaults.options }
							: undefined,
						metadata: registration.defaults.metadata
							? { ...registration.defaults.metadata }
							: undefined,
					}
				: undefined,
			createProvider: registration.createProvider,
			loadProvider: registration.loadProvider,
		});
	}

	configureProvider(config: GatewayProviderConfig): void {
		this.providerConfigs.set(config.providerId, {
			providerId: config.providerId,
			apiKey: config.apiKey,
			apiKeyResolver: config.apiKeyResolver,
			apiKeyEnv: config.apiKeyEnv,
			baseUrl: config.baseUrl,
			headers: config.headers ? { ...config.headers } : undefined,
			timeoutMs: config.timeoutMs,
			fetch: config.fetch,
			options: config.options ? { ...config.options } : undefined,
			metadata: config.metadata ? { ...config.metadata } : undefined,
			enabled: config.enabled ?? true,
			defaultModelId: config.defaultModelId,
			models: config.models?.map((model) => ({ ...model })),
		});
	}

	listProviders(): GatewayProviderManifest[] {
		return Array.from(this.providers.values())
			.map((record) => this.getManifest(record.manifest.id))
			.filter(
				(manifest): manifest is GatewayProviderManifest =>
					manifest !== undefined,
			);
	}

	listModels(providerId?: string): GatewayModelDefinition[] {
		if (providerId) {
			return [...(this.getManifest(providerId)?.models ?? [])];
		}

		return this.listProviders().flatMap((provider) =>
			provider.models.map((model) => ({ ...model })),
		);
	}

	getManifest(providerId: string): GatewayProviderManifest | undefined {
		const record = this.providers.get(providerId);
		if (!record) {
			return undefined;
		}

		const config = this.providerConfigs.get(providerId);
		if (config && !config.enabled) {
			return undefined;
		}

		const models = mergeModels(record.manifest, config);
		const defaultModelId =
			config?.defaultModelId ?? record.manifest.defaultModelId ?? models[0]?.id;

		if (!defaultModelId) {
			return undefined;
		}

		return {
			...cloneManifest(record.manifest),
			defaultModelId,
			models,
			metadata:
				config?.metadata || record.manifest.metadata
					? {
							...(record.manifest.metadata ?? {}),
							...(config?.metadata ?? {}),
						}
					: undefined,
		};
	}

	resolveModel(selection: GatewayModelSelection): GatewayResolvedModel {
		const provider = this.getManifest(selection.providerId);
		if (!provider) {
			throw new Error(
				`Unknown or disabled provider "${selection.providerId}".`,
			);
		}

		const modelId = selection.modelId ?? provider.defaultModelId;
		const model =
			provider.models.find((entry) => entry.id === modelId) ??
			createUnregisteredModel(provider, modelId);

		return {
			provider,
			model,
		};
	}

	async createProvider(providerId: string): Promise<{
		manifest: GatewayProviderManifest;
		config: GatewayResolvedProviderConfig;
		createProvider: GatewayProviderFactory;
	}> {
		const record = this.providers.get(providerId);
		if (!record) {
			throw new Error(`Unknown provider "${providerId}".`);
		}

		if (!record.createProvider) {
			const loaded = await record.loadProvider?.();
			if (!loaded?.createProvider) {
				throw new Error(`Provider "${providerId}" could not be loaded.`);
			}
			record.createProvider = loaded.createProvider;
		}

		const manifest = this.getManifest(providerId);
		if (!manifest) {
			throw new Error(`Provider "${providerId}" is disabled.`);
		}

		const config = this.providerConfigs.get(providerId);
		const mergedMetadata = {
			...(record.defaults?.metadata ?? {}),
			...(config?.metadata ?? {}),
		};
		const metadata =
			Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined;

		return {
			manifest,
			config: {
				providerId,
				apiKey: config?.apiKey ?? record.defaults?.apiKey,
				apiKeyResolver:
					config?.apiKeyResolver ?? record.defaults?.apiKeyResolver,
				apiKeyEnv: config?.apiKeyEnv ?? record.defaults?.apiKeyEnv,
				baseUrl: config?.baseUrl ?? record.defaults?.baseUrl,
				headers: {
					...(record.defaults?.headers ?? {}),
					...(config?.headers ?? {}),
				},
				timeoutMs: config?.timeoutMs ?? record.defaults?.timeoutMs,
				fetch: config?.fetch ?? record.defaults?.fetch ?? this.fallbackFetch,
				options: {
					...(record.defaults?.options ?? {}),
					...(config?.options ?? {}),
				},
				metadata,
			},
			createProvider: record.createProvider,
		};
	}
}
