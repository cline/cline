/**
 * Routing variants are model id suffixes that change how a request is routed
 * (`:floor` cheapest provider, `:nitro` fastest provider, `:exacto` tool-calling
 * quality, `:online` web search) without being separate models. Model lists such
 * as OpenRouter's `/api/v1/models` do not include them, and their metadata
 * (context window, pricing, capabilities) is the base model's.
 *
 * Catalog variants such as `:free` and `:batch` are listed as their own models
 * with their own metadata, so they are deliberately not in this set.
 *
 * https://openrouter.ai/docs/guides/routing/model-variants/overview
 */
const ROUTING_VARIANT_SUFFIXES = new Set(["floor", "nitro", "exacto", "online"])

/**
 * The base id of a model id that ends in a routing variant suffix, e.g.
 * `z-ai/glm-5.3-flash:floor` -> `z-ai/glm-5.3-flash`. Undefined otherwise.
 */
function routingVariantBaseId(modelId: string): string | undefined {
	const separator = modelId.lastIndexOf(":")
	if (separator <= 0 || !ROUTING_VARIANT_SUFFIXES.has(modelId.slice(separator + 1))) {
		return undefined
	}
	return modelId.slice(0, separator)
}

/**
 * Look up catalog metadata for a model id. An exact entry always wins; a
 * routing variant the catalog does not list falls back to its base model's
 * entry. This keys off the id shape rather than the provider, so any catalog
 * that only lists base ids is covered.
 */
export function lookupCatalogModel<T>(modelId: string, lookup: (id: string) => T | undefined): T | undefined {
	const exact = lookup(modelId)
	if (exact !== undefined) {
		return exact
	}
	const baseId = routingVariantBaseId(modelId)
	return baseId === undefined ? undefined : lookup(baseId)
}
