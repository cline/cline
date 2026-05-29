// Phase 0 stub barrel. Public surface grows as later phases add behavior.
/**
 * Public surface of the SDK-backed model catalog.
 *
 * Consumers outside `src/sdk/model-catalog/` import from this barrel only.
 * Internal helpers (`fingerprint`, `effective-config`, `shape-adapter`) are
 * deliberately not re-exported; they are implementation details of the two
 * factory functions. `parseProviderId` is exported as the branded ProviderId
 * boundary constructor for RPC/serialization edges.
 */

export { createProviderCatalog } from "./catalog"
export type {
	CatalogError,
	CatalogSource,
	Disposable,
	EffectiveProviderConfig,
	Fingerprint,
	KnownProviderId,
	Mode,
	ModelInfo,
	ModelSelection,
	ProviderCatalog,
	ProviderConfigChange,
	ProviderConfigChangeListener,
	ProviderConfigPatch,
	ProviderConfigReader,
	ProviderConfigStore,
	ProviderId,
	ProviderListing,
	ProviderModelsEvent,
	ProviderModelsResult,
} from "./contracts"
export { isKnownProviderId, parseProviderId } from "./provider-id"
export { createProviderConfigStore } from "./store"
