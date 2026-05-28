/**
 * Handler-side helper for reading `(modelId, ModelInfo)` from the
 * `@cline/llms` SDK catalog synchronously.
 *
 * `apps/vscode/src/core/api/providers/<provider>.ts` handlers use this
 * inside their `getModel()` methods to resolve the user-supplied
 * `apiModelId` against the canonical SDK catalog, falling back to the
 * provider's SDK-declared default model. It is the host-side companion
 * to `useStaticProviderSelection` on the webview side: both read from
 * the same SDK catalog so the chosen model is consistent end-to-end.
 *
 * Host-side `ModelInfo` overrides (see
 * `apps/vscode/src/sdk/model-catalog/host-overrides.ts`) are applied
 * here so handler-side reads see the same flags as the webview-side
 * reads through gRPC.
 *
 * Intentionally synchronous: handlers are constructed per request and
 * must return a `ModelInfo` without awaiting. The SDK's synchronous
 * `getProviderCollectionSync` covers every static catalog the SDK
 * ships. Providers with dynamic catalogs (Ollama, LM Studio, OpenRouter,
 * …) should consult their own dynamic source instead — the user's
 * selected model may not appear in the SDK builtins.
 */

import { getProviderCollectionSync } from "@cline/llms"
import { applyHostModelInfoOverrides } from "@/sdk/model-catalog/host-overrides"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { adaptSdkModelInfo } from "@/sdk/model-catalog/shape-adapter"
import type { ModelInfo } from "./api"

export interface ResolvedHandlerModel<TId extends string = string> {
	id: TId
	info: ModelInfo
}

/**
 * Resolve `(id, info)` for the given provider.
 *
 * Resolution order:
 *   1. If `committedInfo` is provided alongside a non-empty
 *      `requestedModelId`, return that pair verbatim. This is the
 *      dynamic-provider escape hatch: when the user picks a model that
 *      the SDK catalog does not (yet) know — say, a freshly published
 *      Hugging Face model — the picker stores the live `ModelInfo` on
 *      `ApiConfiguration` and the handler honors it.
 *   2. SDK catalog hit on `requestedModelId`.
 *   3. SDK-declared default for the provider.
 *   4. First model from the SDK collection as a last resort.
 *
 * Throws when the SDK has no entry for `providerId` *and* no models at
 * all. That is a build-time invariant violation (every handler ships
 * against a registered SDK provider id), not a runtime error a caller
 * could meaningfully recover from.
 */
export function getProviderModelFromSdk<TId extends string = string>(
	providerId: string,
	requestedModelId: string | undefined,
	committedInfo?: ModelInfo,
): ResolvedHandlerModel<TId> {
	const requested = requestedModelId?.trim()
	if (requested && committedInfo) {
		return { id: requested as TId, info: committedInfo }
	}
	const collection = getProviderCollectionSync(providerId)
	if (!collection) {
		throw new Error(
			`SDK provider catalog has no entry for "${providerId}". This is a missing provider registration in @cline/llms.`,
		)
	}

	const parsedProviderId = parseProviderId(providerId)
	if (requested && Object.hasOwn(collection.models, requested)) {
		const sdkInfo = collection.models[requested]
		return {
			id: requested as TId,
			info: applyHostModelInfoOverrides(parsedProviderId, requested, adaptSdkModelInfo(sdkInfo)),
		}
	}

	const defaultModelId = collection.provider.defaultModelId
	if (defaultModelId && Object.hasOwn(collection.models, defaultModelId)) {
		const sdkInfo = collection.models[defaultModelId]
		return {
			id: defaultModelId as TId,
			info: applyHostModelInfoOverrides(parsedProviderId, defaultModelId, adaptSdkModelInfo(sdkInfo)),
		}
	}

	// SDK provider has no default and the requested id (if any) does not
	// match. Pick the first available model as a last resort so the
	// handler still produces a usable `(id, info)` pair when the user has
	// a stale id stored on disk.
	const fallbackId = Object.keys(collection.models)[0]
	if (fallbackId) {
		const sdkInfo = collection.models[fallbackId]
		return {
			id: fallbackId as TId,
			info: applyHostModelInfoOverrides(parsedProviderId, fallbackId, adaptSdkModelInfo(sdkInfo)),
		}
	}

	throw new Error(`SDK provider catalog for "${providerId}" has no models registered.`)
}
