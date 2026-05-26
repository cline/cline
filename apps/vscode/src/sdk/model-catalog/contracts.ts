/**
 * SDK-backed Model Catalog — Contracts
 *
 * Companion to:
 *  - tmp/sdk-model-catalog-architecture.md (the *what shape*)
 *  - tmp/sdk-model-catalog-implementation-plan.md (the *what to do*)
 *  - tmp/sdk-model-catalog-design.md (the *why*)
 *
 * This file is the type-level contract for the model catalog system. Every
 * load-bearing invariant from the architecture doc that can be expressed in
 * the type system lives here. Behavior is implemented elsewhere; this file
 * has no runtime side effects.
 *
 * If you are about to write a value cast like `x as ProviderId` or
 * `x as Fingerprint` outside the parse/compute boundary functions, stop and
 * raise a checkpoint. The branded types in this file exist precisely so
 * those casts are never necessary or correct.
 */

import type { ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

declare const ProviderIdBrand: unique symbol
declare const KnownProviderIdBrand: unique symbol
declare const FingerprintBrand: unique symbol

/**
 * A provider identifier. Branded so it cannot be fabricated from a raw
 * `string` without going through `parseProviderId`.
 *
 * Invariant: every `ProviderId` was at some point produced by
 * `parseProviderId`. The string is trimmed and lowercased.
 */
export type ProviderId = string & { readonly [ProviderIdBrand]: void }

/**
 * A `ProviderId` we recognize from `ApiProvider`. Sub-brand of `ProviderId`.
 * Distinguishing "known" from "any" lets us write functions that require a
 * known provider without re-validating, while still accepting arbitrary
 * provider ids (e.g. custom SDK providers) where openness is correct.
 */
export type KnownProviderId = ProviderId & { readonly [KnownProviderIdBrand]: void }

/**
 * Cache-key payload. Branded string. Built only by `computeConfigFingerprint`
 * and equality-compared. Opaque to consumers.
 *
 * Invariant: `computeConfigFingerprint` is total and pure. The same
 * `(providerId, EffectiveProviderConfig)` produces the same fingerprint;
 * different inputs produce different fingerprints (up to hash collision).
 * Raw secrets never appear in the fingerprint output.
 */
export type Fingerprint = string & { readonly [FingerprintBrand]: void }

// ---------------------------------------------------------------------------
// Effective provider config
// ---------------------------------------------------------------------------

/**
 * Effective configuration for a provider, with all overlays (remote config,
 * secrets, defaults) applied. Produced only by `ProviderConfigStore.read`.
 *
 * Invariants:
 *  - `providerId` is the id of the provider this config describes.
 *  - Secrets (apiKey, auth.accessToken) are *included* on the host;
 *    redaction happens at the RPC serialization boundary, not inside the
 *    store. Callers serializing this type across a boundary are responsible
 *    for redaction.
 *  - Two reads with no intervening write return structurally equal values.
 *  - Consumers must not mutate. The shape is `Readonly`.
 *
 * Mode-dependent selection (modelId, modelInfo) is *not* part of this
 * type. Use `ProviderConfigStore.readSelection(providerId, mode)`.
 */
export interface EffectiveProviderConfig {
	readonly providerId: ProviderId
	readonly apiKey?: string
	readonly baseUrl?: string
	readonly apiLine?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly region?: string
	/**
	 * OAuth-style auth bundle (e.g. cline provider's WorkOS token).
	 * Compatible with `apiKey`; some providers populate both.
	 */
	readonly auth?: {
		readonly accessToken?: string
		readonly refreshToken?: string
		readonly accountId?: string
	}
	/**
	 * Provider-specific extras. Prefer adding a typed top-level field over
	 * expanding this map. Used as a compatibility escape hatch during
	 * migration.
	 */
	readonly extras?: Readonly<Record<string, unknown>>
}

/**
 * A patch describing a field-level write to `ProviderConfigStore`.
 *
 * Invariant: `ProviderConfigPatch` cannot describe a model selection. The
 * type does not contain `modelId` or `modelInfo`. To write a selection,
 * use `commitSelection`, which is a structurally distinct method on the
 * store.
 *
 * Empty patches are allowed and are no-ops. A field present with value
 * `null` means "clear this field"; an absent field means "leave unchanged."
 */
export interface ProviderConfigPatch {
	readonly apiKey?: string | null
	readonly baseUrl?: string | null
	readonly apiLine?: string | null
	readonly headers?: Readonly<Record<string, string>> | null
	readonly region?: string | null
	readonly auth?: {
		readonly accessToken?: string
		readonly refreshToken?: string
		readonly accountId?: string
	} | null
	readonly extras?: Readonly<Record<string, unknown>> | null
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

/**
 * A user's committed model selection. The triple is atomic by type: every
 * write of `modelId` carries its `modelInfo` envelope, and vice versa.
 *
 * Invariants:
 *  - `modelInfo` was either taken from a `ProviderCatalog.resolveModels`
 *    result, or constructed from per-provider safe defaults when the user
 *    entered a custom id manually. Either way it represents the picker's
 *    best knowledge at the moment of commit. The runtime uses it verbatim.
 *  - The stored selection wins over later SDK catalog changes. Refresh
 *    does not retroactively change committed selections.
 */
export interface ModelSelection {
	readonly providerId: ProviderId
	readonly modelId: string
	readonly modelInfo: ModelInfo
}

// ---------------------------------------------------------------------------
// Change events
// ---------------------------------------------------------------------------

/**
 * Event fired by `ProviderConfigStore.subscribe` after a committed write.
 * `kind` discriminates field writes from selection commits, so listeners
 * can react appropriately without re-reading.
 */
export type ProviderConfigChange =
	| {
			readonly kind: "fields"
			readonly providerId: ProviderId
			readonly config: EffectiveProviderConfig
	  }
	| {
			readonly kind: "selection"
			readonly providerId: ProviderId
			readonly mode: Mode
			readonly selection: ModelSelection
	  }

export type ProviderConfigChangeListener = (event: ProviderConfigChange) => void

/**
 * Standard disposable for subscription handles.
 */
export interface Disposable {
	dispose(): void
}

// ---------------------------------------------------------------------------
// Provider listings
// ---------------------------------------------------------------------------

/**
 * Lightweight provider entry returned by `ProviderCatalog.listProviders`.
 * Drives the top-level provider picker dropdown. Does *not* include the
 * full model list; use `resolveModels` for that.
 */
export interface ProviderListing {
	readonly id: ProviderId
	readonly name: string
	readonly defaultModelId?: string
	readonly family?: string
	readonly protocol?: string
	readonly authDescription?: string
	readonly baseUrlDescription?: string
	/**
	 * Whether arbitrary model ids are meaningful for this provider. Drives
	 * the manual-entry affordance in `ModelPickerWithManualEntry`.
	 *
	 * Example: Ollama, LM Studio, LiteLLM, OpenAI-compatible → true.
	 * Anthropic, DeepSeek, Gemini → false.
	 */
	readonly allowsCustomModelIds: boolean
}

// ---------------------------------------------------------------------------
// Catalog results
// ---------------------------------------------------------------------------

/**
 * Source of a model-list result. Observability counterpart to the cache
 * record. Logged but not used for control flow.
 */
export type CatalogSource = "sdk-dynamic" | "sdk-bundled" | "extension-dynamic" | "legacy-static" | "host-adapter"

/**
 * Structured error from `resolveModels`. Carries enough information to
 * render an actionable picker state. Does not include raw SDK errors; the
 * catalog's boundary parser translates SDK errors into this shape.
 */
export interface CatalogError {
	readonly kind: "network" | "auth" | "shape" | "config" | "unknown"
	readonly message: string
	/**
	 * Optional provider-side error code (e.g. HTTP status). Informational
	 * only; UI should not switch on it.
	 */
	readonly code?: string
}

/**
 * Result of `ProviderCatalog.resolveModels`. Discriminated by `ok`.
 *
 * Invariant: a `ProviderModelsResult` always carries the `configFingerprint`
 * it was computed against. Consumers compare fingerprints, not timestamps,
 * to decide whether to apply a result.
 */
export type ProviderModelsResult =
	| {
			readonly ok: true
			readonly providerId: ProviderId
			readonly configFingerprint: Fingerprint
			readonly models: ReadonlyMap<string, ModelInfo>
			readonly defaultModelId: string
			readonly source: CatalogSource
			readonly fetchedAt: number
	  }
	| {
			readonly ok: false
			readonly providerId: ProviderId
			readonly configFingerprint: Fingerprint
			readonly error: CatalogError
			readonly fetchedAt: number
	  }

/**
 * Event fired by `ProviderCatalog.subscribe` whenever a `resolveModels`
 * call completes for the subscribed provider.
 */
export interface ProviderModelsEvent {
	readonly providerId: ProviderId
	readonly result: ProviderModelsResult
}

// ---------------------------------------------------------------------------
// The two abstractions
// ---------------------------------------------------------------------------

/**
 * Read-only view of `ProviderConfigStore`. Held by `ProviderCatalog` so the
 * catalog cannot write. Enforces invariant C1 (catalog is read-only with
 * respect to the store) by type.
 *
 * If a future need arises to grant a non-store consumer write access,
 * pass it the full `ProviderConfigStore` interface explicitly; do not
 * widen this reader type.
 */
export interface ProviderConfigReader {
	read(providerId: ProviderId): EffectiveProviderConfig
	readSelection(providerId: ProviderId, mode: Mode): ModelSelection | undefined
	subscribe(listener: ProviderConfigChangeListener): Disposable
}

/**
 * The provider configuration store. Owns and serializes all writes to
 * user-edited provider configuration fields and committed model selections.
 *
 * Storage strategy is private. Implementations decide whether each field
 * lives in StateManager, providers.json, remote config overlays, or
 * elsewhere. Consumers must not name the storage layout.
 *
 * Invariants (also documented per method):
 *  - I1. `read(p)` after `write(p, patch)` reflects `patch`. Always.
 *  - I2. `commitSelection` is the only producer of selection events.
 *  - I3. `write` cannot produce a selection event.
 *  - I4. Two reads with no intervening write are structurally equal.
 *  - I5. Subscribers fire synchronously before the write that triggered
 *    them returns.
 *  - I6. Secrets do not cross serialization boundaries; that is the
 *    responsibility of the caller crossing the boundary (e.g. RPC handler).
 */
export interface ProviderConfigStore extends ProviderConfigReader {
	/**
	 * Update fields. In-memory cache is updated before this returns; disk
	 * persistence is debounced. Returns the new effective config.
	 *
	 * I3: `write` does not accept selection fields by type, so it cannot
	 * commit a selection. Listeners receive a `"fields"` event, not a
	 * `"selection"` event.
	 */
	write(providerId: ProviderId, patch: ProviderConfigPatch): EffectiveProviderConfig

	/**
	 * Commit a model selection atomically with its info envelope. The only
	 * entry point that writes `{providerId, modelId, modelInfo}` triples.
	 *
	 * I2: refresh handlers do not have access to this method by type, since
	 * `ProviderCatalog` holds only a `ProviderConfigReader`.
	 */
	commitSelection(providerId: ProviderId, mode: Mode, selection: ModelSelection): void
}

/**
 * The provider model catalog. Resolves model lists and provider listings
 * from the SDK (and host adapters where applicable). Manages a
 * fingerprint-keyed cache and in-flight request dedup internally.
 *
 * Invariants (also documented per method):
 *  - C1. Holds a `ProviderConfigReader`, not a `ProviderConfigStore`.
 *    Cannot write to the store. Enforced by type.
 *  - C2. Every result carries the `configFingerprint` it was computed
 *    against.
 *  - C3. Cache and in-flight maps are keyed by `${providerId}:${fingerprint}`.
 *  - C4. Reacts to store changes by invalidating non-matching fingerprints;
 *    does not invalidate the user's selection.
 *  - C5. Never writes selection.
 *  - C6. Validates SDK responses at the boundary; malformed responses
 *    produce `CatalogError`, not malformed downstream data.
 */
export interface ProviderCatalog {
	/**
	 * List providers available from the SDK catalog. Used by the top-level
	 * provider picker.
	 */
	listProviders(): Promise<ReadonlyArray<ProviderListing>>

	/**
	 * Resolve models for a provider given the current effective config.
	 * Reads effective config from the store; callers do not pass it.
	 *
	 * `forceRefresh: true` bypasses cache for the current fingerprint;
	 * in-flight dedup is still honored.
	 */
	resolveModels(providerId: ProviderId, options?: { readonly forceRefresh?: boolean }): Promise<ProviderModelsResult>

	/**
	 * Subscribe to model-list updates for a provider. Fires after each
	 * `resolveModels` completion for that provider.
	 */
	subscribe(providerId: ProviderId, listener: (event: ProviderModelsEvent) => void): Disposable
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { ModelInfo, Mode }
