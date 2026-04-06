import type { ModelCollection, ModelInfo, ProviderInfo } from "../models/index";
import type {
	ProviderCapability as ModelProviderCapability,
	ProviderClient,
	ProviderProtocol,
} from "../models/types";
import type {
	ApiHandler,
	BuiltInProviderId,
	HandlerFactory,
	LazyHandlerFactory,
	ProviderCapability,
	ProviderConfig,
} from "../providers/index";

export type ProviderConfigDefaults = Omit<
	ProviderConfig,
	"providerId" | "modelId"
>;

export interface ProviderSelectionConfig {
	id: string;
	models: string[];
	defaultModel?: string;
	builtinProviderId?: BuiltInProviderId;
	apiKey?: string;
	apiKeyEnv?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	capabilities?: ProviderCapability[];
	settings?: ProviderConfigDefaults;
}

export interface AdditionalModelConfig {
	providerId: string;
	modelId: string;
	info: ModelInfo;
}

export interface CustomProviderConfig {
	collection: ModelCollection;
	defaults?: ProviderConfigDefaults;
	handlerFactory?: HandlerFactory;
	asyncHandlerFactory?: LazyHandlerFactory;
}

export interface LlmsConfig {
	providers: ProviderSelectionConfig[];
	models?: AdditionalModelConfig[];
	customProviders?: CustomProviderConfig[];
}

export interface CreateHandlerInput {
	providerId: string;
	modelId?: string;
	overrides?: ProviderConfigDefaults;
}

export interface RegisteredProviderSummary {
	id: string;
	models: string[];
	defaultModel: string;
}

export interface BuiltInProviderSummary
	extends Pick<
		ProviderInfo,
		| "id"
		| "name"
		| "description"
		| "protocol"
		| "baseUrl"
		| "capabilities"
		| "env"
	> {
	models: string[];
	defaultModel: string;
	modelCount: number;
}

export interface RegisterBuiltinProviderInput {
	id: string;
	builtinProviderId: BuiltInProviderId;
	models: Record<string, ModelInfo>;
	name?: string;
	description?: string;
	protocol?: ProviderProtocol;
	baseUrl?: string;
	client?: ProviderClient;
	capabilities?: ModelProviderCapability[];
	env?: string[];
	defaultModel?: string;
	defaults?: ProviderConfigDefaults;
	exposeModels?: string[];
}

export interface RegisterProviderInput extends CustomProviderConfig {
	exposeModels?: string[];
	defaultModel?: string;
}

export interface RegisterModelInput {
	providerId: string;
	modelId: string;
	info: ModelInfo;
}

export interface LlmsSdk {
	createHandler(input: CreateHandlerInput): ApiHandler;
	createHandlerAsync(input: CreateHandlerInput): Promise<ApiHandler>;
	registerProvider(input: RegisterProviderInput): void;
	registerBuiltinProvider(input: RegisterBuiltinProviderInput): void;
	registerModel(input: RegisterModelInput): void;
	getProviders(): RegisteredProviderSummary[];
	getBuiltInProviderIds(): BuiltInProviderId[];
	getBuiltInProviders(): Promise<BuiltInProviderSummary[]>;
	getModels(providerId: string): string[];
	isProviderConfigured(providerId: string): boolean;
	isModelConfigured(providerId: string, modelId: string): boolean;
}
