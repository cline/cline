// Phase 0 stub. Behavior added in Phase 3.

import type {
	Disposable,
	ProviderCatalog,
	ProviderConfigReader,
	ProviderId,
	ProviderListing,
	ProviderModelsEvent,
	ProviderModelsResult,
} from "./contracts"

/**
 * Create a {@link ProviderCatalog}.
 *
 * Accepts a read-only {@link ProviderConfigReader} (not the full store).
 * Enforces invariant C1 by type: the catalog cannot write to the store,
 * and has no `write`/`commitSelection` access by construction.
 *
 * Phase 0 stub: every method throws a clear Phase 0 error.
 */
export function createProviderCatalog(reader: ProviderConfigReader): ProviderCatalog {
	void reader
	const unimplemented = (method: string): never => {
		throw new Error(`ProviderCatalog.${method}: not implemented (Phase 0 stub)`)
	}

	return {
		async listProviders(): Promise<ReadonlyArray<ProviderListing>> {
			return unimplemented("listProviders")
		},

		async resolveModels(
			_providerId: ProviderId,
			_options?: { readonly forceRefresh?: boolean },
		): Promise<ProviderModelsResult> {
			return unimplemented("resolveModels")
		},

		subscribe(_providerId: ProviderId, _listener: (event: ProviderModelsEvent) => void): Disposable {
			return unimplemented("subscribe")
		},
	}
}
