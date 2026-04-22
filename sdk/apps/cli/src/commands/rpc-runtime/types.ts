import type { ProviderCapability } from "@clinebot/core";

export type StoredModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId: string;
				capabilities?: ProviderCapability[];
				modelsSourceUrl?: string;
			};
			models: Record<
				string,
				{
					id: string;
					name?: string;
					supportsVision?: boolean;
					supportsAttachments?: boolean;
				}
			>;
		}
	>;
};
