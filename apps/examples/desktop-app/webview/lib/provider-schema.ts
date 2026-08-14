import type {
	ModelModality,
	ModelOperation,
	ModelOperationMode,
} from "@cline/shared/browser";

export interface ProviderModel {
	id: string;
	name: string;
	operation?: ModelOperation;
	operationModes?: ModelOperationMode[];
	contextWindow?: number;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
	supportsReasoning?: boolean;
	inputModalities?: ModelModality[];
	outputModalities?: ModelModality[];
}

export type { ModelModality, ModelOperation, ModelOperationMode };

export type ProviderConfigFieldType =
	| "text"
	| "password"
	| "url"
	| "number"
	| "select"
	| "boolean";

export type ProviderConfigFieldPrimitive = string | number | boolean | null;

export interface ProviderConfigFieldOption {
	label: string;
	value: Exclude<ProviderConfigFieldPrimitive, null>;
}

export interface ProviderConfigField {
	path: string;
	label: string;
	type: ProviderConfigFieldType;
	description?: string;
	placeholder?: string;
	required?: boolean;
	secret?: boolean;
	options?: ProviderConfigFieldOption[];
	defaultValue?: ProviderConfigFieldPrimitive;
}

export interface Provider {
	id: string;
	name: string;
	models: number | null;
	color: string;
	letter: string;
	enabled: boolean;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	baseUrl?: string;
	docUrl?: string;
	docLabel?: string;
	defaultModelId?: string;
	capabilities?: string[];
	authDescription?: string;
	baseUrlDescription?: string;
	configFields?: ProviderConfigField[];
	configValues?: Record<string, ProviderConfigFieldPrimitive>;
	modelList?: ProviderModel[];
}

export interface ProviderSettingsUpdate {
	apiKey?: string;
	baseUrl?: string;
	configValues?: Record<string, ProviderConfigFieldPrimitive>;
}

export interface ProviderCatalogResponse {
	providers: Provider[];
	settingsPath: string;
	voiceInput?: VoiceInputSelection;
}

export interface VoiceInputSelection {
	providerId: string;
	modelId: string;
}

export interface ProviderModelsResponse {
	providerId: string;
	models: ProviderModel[];
}
