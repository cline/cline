import { toSdkProviderId } from "./sdk-provider-id"

// Providers whose model id is user-supplied free text rather than a fixed
// catalog selection. The SDK catalog for these either has no curated model
// list (openai-compatible: bring-your-own base URL + model) or a host-fetched
// list that the user can also bypass (ollama/lmstudio/litellm/vertex). For these,
// the picker must allow arbitrary model ids and model resolution must honor
// the requested id instead of coercing to the catalog default.
const CUSTOM_MODEL_ID_PROVIDER_IDS = new Set(["openai-compatible", "ollama", "lmstudio", "litellm", "vertex"])

/**
 * Whether a provider id accepts a user-supplied (custom) model id.
 *
 * Keep this helper in a side-effect-free module so lightweight controller
 * handlers (e.g. `resolveModelInfo`) do not import the full provider catalog
 * implementation and its feature-flag/controller dependency graph.
 *
 * Accepts either the extension or SDK provider id spelling (the extension's
 * `openai` maps to the SDK's `openai-compatible`).
 */
export function providerAllowsCustomModelIds(providerId: string): boolean {
	return CUSTOM_MODEL_ID_PROVIDER_IDS.has(toSdkProviderId(providerId))
}
