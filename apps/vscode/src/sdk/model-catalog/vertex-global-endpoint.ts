/**
 * Vertex global-endpoint allowlist.
 *
 * Google Vertex AI's `location: "global"` value routes requests to the
 * closest backend instead of a fixed region. Only a subset of Vertex
 * models supports it — picking `location: "global"` with an unsupported
 * model returns a `model not available in region: global` error at
 * request time. The settings picker filters its model list when the
 * user selects `vertexRegion === "global"` so the combination cannot be
 * chosen in the first place.
 *
 * Region is configured separately from the model id (see
 * `config.options.location` in
 * `sdk/packages/llms/src/providers/vendors/vertex.ts`), so model ids do
 * not encode region. They do carry an Anthropic-style version pin
 * suffix on the Claude family (for example `claude-opus-4-7@default`
 * for the latest variant and `claude-sonnet-4-5@20250929` for a
 * specific snapshot). All version pins of a given base model share the
 * same global-endpoint capability, so the allowlist is keyed by
 * base-model prefix and matches the bare id as well as any
 * `${prefix}@...` snapshot variant or `${prefix}:...` legacy
 * context-window/speed suffix (for example `claude-opus-4-7:1m`).
 *
 * The `@cline/llms` SDK does not carry per-model global-endpoint
 * metadata, so the allowlist lives here. When the SDK adopts a
 * capability flag for this, the file (and the override in
 * `host-overrides.ts` that applies it) should be deleted.
 */

import type { ProviderId } from "./contracts"

/**
 * Vertex base-model prefixes whose `@suffix` variants all support
 * `location: "global"`. A model id matches the allowlist when it is
 * equal to one of these prefixes or starts with `${prefix}@`. Update
 * when the SDK's Vertex catalog gains new global-endpoint-capable base
 * models.
 */
const VERTEX_GLOBAL_ENDPOINT_BASE_IDS: readonly string[] = [
	// Claude on Vertex: every variant of these base ids supports global.
	"claude-3-7-sonnet",
	"claude-sonnet-4",
	"claude-sonnet-4-5",
	"claude-sonnet-4-6",
	"claude-fable-5",
	"claude-opus-4",
	"claude-opus-4-1",
	"claude-opus-4-5",
	"claude-opus-4-6",
	"claude-opus-4-7",
	"claude-haiku-4-5",
	// Gemini on Vertex: not in the SDK's Vertex catalog today; listed
	// here so they are honored when the SDK adds them.
	"gemini-2.0-flash-001",
	"gemini-2.0-flash-lite-001",
	"gemini-2.0-flash-thinking-exp-1219",
	"gemini-2.0-flash-thinking-exp-01-21",
	"gemini-2.0-flash-exp",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite-preview-06-17",
	"gemini-2.5-pro",
	"gemini-3-flash-preview",
	"gemini-3-pro-preview",
	"gemini-3.1-pro-preview",
	"gemini-3.5-flash",
]

/**
 * Returns true when the given Vertex model id is known to work with the
 * `location: "global"` Vertex region. Returns false for any other
 * `providerId`; this is a Vertex-only concept.
 */
export function vertexModelSupportsGlobalEndpoint(providerId: ProviderId, modelId: string): boolean {
	if (providerId !== "vertex") {
		return false
	}
	return VERTEX_GLOBAL_ENDPOINT_BASE_IDS.some(
		(base) => modelId === base || modelId.startsWith(`${base}@`) || modelId.startsWith(`${base}:`),
	)
}
