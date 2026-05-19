export interface ProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
	supportsReasoning?: boolean;
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
	authDescription?: string;
	baseUrlDescription?: string;
	modelList?: ProviderModel[];
}

export interface ProviderCatalogResponse {
	providers: Provider[];
	settingsPath: string;
}

export interface ProviderModelsResponse {
	providerId: string;
	models: ProviderModel[];
}
