// Phase 0 stub. Behavior added in Phase 1.

import type {
	Disposable,
	EffectiveProviderConfig,
	Mode,
	ModelSelection,
	ProviderConfigChangeListener,
	ProviderConfigPatch,
	ProviderConfigStore,
	ProviderId,
} from "./contracts"

/**
 * Create a {@link ProviderConfigStore}.
 *
 * Phase 0 stub: every method throws a clear Phase 0 error. This stub
 * exists so consumers can be wired against the contract shape and the
 * compile chain stays green; no real behavior is provided.
 */
export function createProviderConfigStore(): ProviderConfigStore {
	const unimplemented = (method: string): never => {
		throw new Error(`ProviderConfigStore.${method}: not implemented (Phase 0 stub)`)
	}

	return {
		read(_providerId: ProviderId): EffectiveProviderConfig {
			return unimplemented("read")
		},

		readSelection(_providerId: ProviderId, _mode: Mode): ModelSelection | undefined {
			return unimplemented("readSelection")
		},

		subscribe(_listener: ProviderConfigChangeListener): Disposable {
			return unimplemented("subscribe")
		},

		write(_providerId: ProviderId, _patch: ProviderConfigPatch): EffectiveProviderConfig {
			return unimplemented("write")
		},

		commitSelection(_providerId: ProviderId, _mode: Mode, _selection: ModelSelection): void {
			unimplemented("commitSelection")
		},
	}
}
