export {
	getAllProviders,
	getModelsForProvider,
	getProvider,
	getProviderCollection,
	getProviderIds,
	hasProvider,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	registerModel,
	registerProvider,
	resetRegistry,
	unregisterProvider,
} from "./gateway/model-registry";
export { getGeneratedModelsForProvider } from "./model/catalog.generated-access";
export type {
	ModelCollection,
	ModelInfo,
	ProviderCapability,
	ProviderInfo,
} from "./model/types";
