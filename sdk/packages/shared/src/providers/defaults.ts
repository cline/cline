/**
 * Fallback default model for the Cline provider. The `cline` provider manifest
 * in `@cline/llms` prefers the first entry of the Cline recommended-models list
 * and falls back to this id when that list is empty.
 */
export const CLINE_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5.5";

/**
 * The same default model expressed in Anthropic's first-party id format.
 *
 * Gateways (Cline, OpenRouter) address Anthropic models with a namespaced,
 * dotted id (`anthropic/claude-sonnet-5.5`); Anthropic's own API uses a bare,
 * dash-separated id (`claude-sonnet-5-5`). Derive it from
 * {@link CLINE_DEFAULT_MODEL_ID} so the two can never drift apart.
 */
export const ANTHROPIC_DEFAULT_MODEL_ID = CLINE_DEFAULT_MODEL_ID.replace(
	/^anthropic\//,
	"",
).replaceAll(".", "-");
