import { type ApiProvider, type RuntimeId, getLegacyProviderForRuntimeId, getRuntimeIdForProvider } from "@shared/api"
import type { RuntimeDefinition } from "./contracts"
import { RuntimeRegistry } from "./registry"

export function resolveRuntimeIdFromProvider(provider?: ApiProvider, registry?: RuntimeRegistry): RuntimeId {
	const runtimeId = getRuntimeIdForProvider(provider)

	if (registry) {
		registry.getRuntime(runtimeId)
	}

	return runtimeId
}

export function resolveLegacyProviderForRuntime(runtimeId: RuntimeId, registry?: RuntimeRegistry): ApiProvider {
	if (registry) {
		return registry.getRuntime(runtimeId).legacyProvider
	}

	const provider = getLegacyProviderForRuntimeId(runtimeId)
	if (!provider) {
		throw new Error(`Runtime ${runtimeId} does not have a legacy ApiProvider mapping`)
	}

	return provider
}

export function createLegacyRuntimeMapping(definitions: RuntimeDefinition[]): Partial<Record<ApiProvider, RuntimeId>> {
	return definitions.reduce<Partial<Record<ApiProvider, RuntimeId>>>((mapping, definition) => {
		mapping[definition.legacyProvider] = definition.runtimeId
		return mapping
	}, {})
}
