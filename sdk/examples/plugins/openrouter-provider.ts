/**
 * Custom Model Provider Plugin Example
 *
 * Shows how a plugin can register a brand-new model provider so the agent can
 * run inference against it, no changes to Cline itself required.
 *
 * This example registers an OpenAI-compatible provider pointed at OpenRouter.
 * OpenRouter ships as a built-in provider in Cline already, so this example
 * registers under a distinct id (`openrouter-plugin`) to avoid colliding with
 * the built-in. It exists to demonstrate the pattern. Swap the `BASE_URL`,
 * `API_KEY_ENV`, and `MODELS` below to add any OpenAI-compatible endpoint
 * (a self-hosted LiteLLM/vLLM gateway, an internal proxy, a niche provider Cline
 * does not bundle, etc.).
 *
 * How it works:
 *   - `Llms.registerProvider(collection)` adds the provider and its models to
 *     the gateway catalog. With `protocol: "openai-chat"` and
 *     `client: "openai-compatible"`, the gateway builds an OpenAI-compatible
 *     handler from the `baseUrl` and resolves the API key from the session
 *     config or the `env` var declared on the provider.
 *   - `api.registerProvider(...)` declares the contribution on the plugin
 *     (required by the `providers` capability) so hosts can advertise it.
 */

import { type AgentPlugin, Llms } from "@cline/core";

// ---------------------------------------------------------------------------
// Provider definition
//
// Change these constants to point at any OpenAI-compatible endpoint.
// ---------------------------------------------------------------------------

// Provider id exposed by this plugin. Kept distinct from the built-in
// `openrouter` so the two do not collide.
const PROVIDER_ID = "openrouter-plugin";
const PROVIDER_NAME = "OpenRouter (plugin)";
const BASE_URL = "https://openrouter.ai/api/v1";
/** Env var the gateway reads for the API key when one is not passed in the
 * session config. */
const API_KEY_ENV = "OPENROUTER_API_KEY";
const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4.6";

// ---------------------------------------------------------------------------
// Model catalog
//
// Pricing is per 1M tokens and is illustrative; keep it in sync with the
// provider's own pricing page. `capabilities` tells the runtime what each
// model supports (tool calling, streaming, prompt caching, reasoning, images).
// ---------------------------------------------------------------------------

const MODELS: Record<string, Llms.ModelInfo> = {
	"anthropic/claude-sonnet-4.6": {
		id: "anthropic/claude-sonnet-4.6",
		name: "Claude Sonnet 4.6",
		contextWindow: 200_000,
		maxTokens: 8_192,
		capabilities: ["tools", "streaming", "prompt-cache", "reasoning", "images"],
		pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	},
	"openai/gpt-5": {
		id: "openai/gpt-5",
		name: "GPT-5",
		contextWindow: 400_000,
		maxTokens: 16_384,
		capabilities: ["tools", "streaming", "reasoning", "images"],
		pricing: { input: 1.25, output: 10 },
	},
	"google/gemini-2.5-pro": {
		id: "google/gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		capabilities: ["tools", "streaming", "reasoning", "images"],
		pricing: { input: 1.25, output: 10 },
	},
};

function buildCollection(): Llms.ModelCollection {
	const provider: Llms.ProviderInfo = {
		id: PROVIDER_ID,
		name: PROVIDER_NAME,
		description:
			"OpenAI-compatible OpenRouter endpoint registered by a plugin.",
		// openai-chat protocol + openai-compatible client => the gateway builds
		// an OpenAI-compatible handler from baseUrl and the resolved API key.
		protocol: "openai-chat",
		client: "openai-compatible",
		baseUrl: BASE_URL,
		defaultModelId: DEFAULT_MODEL_ID,
		// env is the API key env var the gateway falls back to when the session
		// config does not carry an explicit key.
		env: [API_KEY_ENV],
		// Provider capabilities use the provider-level schema. Image support is
		// represented as "vision" here and as "images" on individual models.
		capabilities: ["tools", "streaming", "prompt-cache", "reasoning", "vision"],
		// "file" marks this as a user-added provider rather than a built-in
		// ("system"), which affects trust-level prompts in some hosts.
		source: "file",
	};

	return { provider, models: MODELS };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: AgentPlugin = {
	name: "openrouter-provider",
	manifest: {
		capabilities: ["providers"],
		// Declared so hosts that pre-validate contributions know which provider
		// ids this plugin owns before importing it.
		providerIds: [PROVIDER_ID],
	},

	setup(api, ctx) {
		// 1. Register the provider + models with the gateway catalog. This is what
		//    makes inference actually work. The gateway can now resolve
		//    `openrouter-plugin` and its models and build a handler for them.
		Llms.registerProvider(buildCollection());

		// 2. Declare the contribution on the plugin. Required by the "providers"
		//    capability; lets hosts advertise the provider in pickers and surface
		//    its metadata.
		api.registerProvider({
			name: PROVIDER_ID,
			description: `${PROVIDER_NAME}: OpenAI-compatible endpoint at ${BASE_URL}`,
			metadata: {
				baseUrl: BASE_URL,
				apiKeyEnv: API_KEY_ENV,
				defaultModelId: DEFAULT_MODEL_ID,
				modelIds: Object.keys(MODELS),
			},
		});

		ctx.logger?.log(
			`[openrouter-provider] registered provider "${PROVIDER_ID}" with ${Object.keys(MODELS).length} model(s)`,
		);
	},
};

export { plugin, buildCollection };
export default plugin;
