import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayReasoningFormat,
	GatewayStreamRequest,
	ModelOperation,
	ModelReasoningOption,
	ReasoningEffort,
} from "@cline/shared";
import { REASONING_LEVELS } from "@cline/shared";

const ACTIVE_REASONING_EFFORTS = REASONING_LEVELS.filter(
	(level): level is ReasoningEffort => level !== "none",
);

interface ModelReasoningControls {
	effort?: Extract<ModelReasoningOption, { type: "effort" }>;
	budget?: Extract<ModelReasoningOption, { type: "budget_tokens" }>;
	toggle: boolean;
	efforts: ReasoningEffort[];
	supportsOff: boolean;
	supportsDefault: boolean;
}

export function getModelReasoningControls(
	options: readonly ModelReasoningOption[] | undefined,
): ModelReasoningControls | undefined {
	if (options === undefined) {
		return undefined;
	}

	const effort = options.find((option) => option.type === "effort");
	const budget = options.find((option) => option.type === "budget_tokens");
	const toggle = options.some((option) => option.type === "toggle");
	const advertised = new Set(effort?.values ?? []);
	return {
		effort,
		budget,
		toggle,
		efforts: ACTIVE_REASONING_EFFORTS.filter((value) => advertised.has(value)),
		supportsOff: toggle || advertised.has("none"),
		supportsDefault: advertised.has("default"),
	};
}

export function normalizeReasoningEffort(
	effort: ReasoningEffort,
	supportedEfforts: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
	if (supportedEfforts.length === 0) {
		return undefined;
	}
	if (supportedEfforts.includes(effort)) {
		return effort;
	}

	const requestedIndex = ACTIVE_REASONING_EFFORTS.indexOf(effort);
	return supportedEfforts.reduce((nearest, candidate) => {
		const nearestDistance = Math.abs(
			ACTIVE_REASONING_EFFORTS.indexOf(nearest) - requestedIndex,
		);
		const candidateDistance = Math.abs(
			ACTIVE_REASONING_EFFORTS.indexOf(candidate) - requestedIndex,
		);
		// On a tie, preserve more capability.
		return candidateDistance <= nearestDistance ? candidate : nearest;
	});
}

export function resolveModelFamily(
	context: GatewayProviderContext,
): string | undefined {
	const family = context.model.metadata?.family;
	return typeof family === "string" ? family : undefined;
}

export function normalizeRoutingValue(value: string | undefined) {
	const normalized = value?.trim().toLowerCase();
	return normalized ? normalized : undefined;
}

function normalizedFamily(context: GatewayProviderContext): string {
	return normalizeRoutingValue(resolveModelFamily(context)) ?? "";
}

function normalizedModelId(
	request: Pick<GatewayStreamRequest, "modelId">,
): string {
	return normalizeRoutingValue(request.modelId) ?? "";
}

function geminiModelDescriptor(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): string {
	return [
		input.request.modelId,
		input.context.model.id,
		input.context.model.name,
		input.context.model.metadata?.family,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

function isProviderBaseOrigin(
	context: GatewayProviderContext,
	origin: string,
): boolean {
	const baseUrl = normalizeRoutingValue(
		context.config.baseUrl ?? context.provider.api,
	)?.replace(/\/+$/, "");
	if (!baseUrl) {
		return false;
	}

	try {
		return new URL(baseUrl).origin.toLowerCase() === origin;
	} catch {
		return baseUrl === origin || baseUrl.startsWith(`${origin}/`);
	}
}

function isAnthropicLineageValue(value: string | undefined): boolean {
	const normalized = normalizeRoutingValue(value);
	return normalized
		? normalized.includes("anthropic") || normalized.includes("claude")
		: false;
}

function isClaudeLineageValue(value: string | undefined): boolean {
	return normalizeRoutingValue(value)?.includes("claude") ?? false;
}

function isQwenLineageValue(value: string | undefined): boolean {
	const normalized = normalizeRoutingValue(value);
	return normalized
		? /(^|[/:._-])qwen(?:$|[/:._-]|\d)/.test(normalized)
		: false;
}

export function isAnthropicCompatibleModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	const family = normalizeRoutingValue(options.family);
	if (family) {
		return isAnthropicLineageValue(family);
	}

	return isAnthropicCompatibleModelId(options.modelId);
}

export function isAnthropicCompatibleModelId(
	modelId: string | undefined,
): boolean {
	if (!modelId) {
		return false;
	}

	return isAnthropicLineageValue(modelId);
}

export function isClaudeModelId(modelId: string | undefined): boolean {
	if (!modelId) {
		return false;
	}

	return isClaudeLineageValue(modelId);
}

export function isClaudeFableModelId(modelId: string | undefined): boolean {
	return normalizeRoutingValue(modelId)?.includes("claude-fable") ?? false;
}

// Known pre-adaptive Claude families that only accept the manual
// `thinking: {type: "enabled", budgetTokens}` wire shape (or no thinking at
// all): Claude Instant, 2.x, and 3.x version-first ids. Mirrors the legacy
// guard in @ai-sdk/anthropic's capability lookup.
const CLAUDE_LEGACY_FAMILY_PATTERN =
	/claude-(?:instant(?:-|$)|v?2(?=$|[-.:])|3(?=$|[-.]))/;

// Matches modern name-first Anthropic ids ("claude-sonnet-4-6",
// "claude-opus-5", "anthropic.claude-opus-4-8-v1:0", "claude-sonnet-4.6").
// The minor is capped at two digits so date-stamp suffixes
// ("claude-sonnet-5-20260629") do not parse as versions.
const CLAUDE_NAME_FIRST_VERSION_PATTERN =
	/claude-(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d{1,2}))?(?=$|[-.:@])/;

/**
 * Wire-shape era of a Claude model id, used only as a fallback when catalog
 * `reasoningOptions` metadata is unavailable (offline baked catalog,
 * user-typed unlisted ids such as "claude-opus-4-6:1m").
 *
 * - "adaptive": 4.6+/5.x models; the Anthropic API rejects the manual
 *   `thinking: {type: "enabled", budgetTokens}` shape for these.
 * - "legacy": known pre-4.6 families that require the manual shape.
 * - "unknown-claude": a Claude id the version parser does not recognize.
 *   Callers should treat these as NEWER than the known list and prefer
 *   adaptive — the forward-compatible policy the ecosystem converged on
 *   (vercel/ai#17804 for @ai-sdk/anthropic's capability lookup; opencode's
 *   transform.ts after repeated allowlist misses for opus-4.7, sonnet-5,
 *   and opus-5). New Claude releases reject the manual shape, so an
 *   allowlist that lags a release turns every reasoning request into a
 *   hard API error.
 * - "not-claude": non-Claude ids (including Anthropic-compatible aliases)
 *   stay conservative for third-party endpoints.
 */
export type ClaudeThinkingEra =
	| "adaptive"
	| "legacy"
	| "unknown-claude"
	| "not-claude";

export function resolveClaudeThinkingEra(
	modelId: string | undefined,
): ClaudeThinkingEra {
	const normalized = normalizeRoutingValue(modelId);
	if (!normalized || !normalized.includes("claude")) {
		return "not-claude";
	}
	if (CLAUDE_LEGACY_FAMILY_PATTERN.test(normalized)) {
		return "legacy";
	}

	const match = CLAUDE_NAME_FIRST_VERSION_PATTERN.exec(normalized);
	if (match) {
		const major = Number(match[1]);
		const minor = match[2] !== undefined ? Number(match[2]) : 0;
		return major >= 5 || (major === 4 && minor >= 6) ? "adaptive" : "legacy";
	}

	return "unknown-claude";
}

export function isQwenModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	const family = normalizeRoutingValue(options.family);
	if (isQwenLineageValue(family)) {
		return true;
	}

	return isQwenLineageValue(options.modelId);
}

// OpenAI reasoning-era chat models: the o-series (o1/o3/o4, including -mini,
// -pro, and dated variants) and the gpt-5 family (including gpt-5-chat).
// These models diverge from classic chat-completions parameter rules — most
// importantly they reject `max_tokens` and require `max_completion_tokens`.
// Detection is an id-pattern fallback (mirroring the legacy extension's
// OpenAI handler) because OpenAI-compatible endpoints accept free-form,
// user-typed model ids with no catalog metadata to rely on. The patterns
// require non-alphanumeric boundaries so ids like "gpt-4o" or "yolo1" never
// match, while namespaced ids like "openai/o3-mini" do.
//
// Maintenance:
// - If OpenAI ships a new family with the same parameter rules (e.g. gpt-6),
//   add a pattern here and cases to the positive/negative lists in
//   `vendors/openai-compatible.test.ts`. The failure mode until then is the
//   loud, self-describing OpenAI 400 ("'max_tokens' is not supported with
//   this model. Use 'max_completion_tokens' instead."), not silent breakage.
// - Keep the boundary anchoring on BOTH sides of each pattern; loosening it
//   risks renaming the parameter for unrelated third-party models.
// - Only `withMaxCompletionTokensForReasoningModels` in
//   `vendors/openai-compatible.ts` consumes this. If a future
//   `@ai-sdk/openai-compatible` maps `max_completion_tokens` itself (as
//   `@ai-sdk/openai` already does), delete that transform and this helper.
const OPENAI_O_SERIES_MODEL_ID_PATTERN = /(^|[^a-z0-9])o[134](?=$|[^a-z0-9])/;
const OPENAI_GPT5_FAMILY_MODEL_ID_PATTERN =
	/(^|[^a-z0-9])gpt-?5(?=$|[^a-z0-9])/;

export function isOpenAIReasoningEraModelId(
	modelId: string | undefined,
): boolean {
	const normalized = normalizeRoutingValue(modelId);
	if (!normalized) {
		return false;
	}

	return (
		OPENAI_O_SERIES_MODEL_ID_PATTERN.test(normalized) ||
		OPENAI_GPT5_FAMILY_MODEL_ID_PATTERN.test(normalized)
	);
}

export function resolveGeminiThinkingMode(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): "level" | "budget" | undefined {
	const controls = getModelReasoningControls(
		input.context.model.reasoningOptions,
	);
	if (controls) {
		return controls.effort
			? "level"
			: controls.budget || controls.toggle
				? "budget"
				: undefined;
	}

	// Legacy/offline catalogs do not yet carry reasoning_options. Keep their
	// wire choice in one fallback boundary; live models use metadata above.
	const descriptor = geminiModelDescriptor(input);
	return /(^|[/\s])gemini-3([.-]|$)/.test(descriptor)
		? "level"
		: /(^|[/\s])gemini-2\.5([-\s]|$)/.test(descriptor) ||
				descriptor.includes("gemini-flash-latest")
			? "budget"
			: undefined;
}

function modelFamilyMatches(
	family: string | undefined,
	routeFamily: string | undefined,
): boolean {
	const normalizedFamily = normalizeRoutingValue(family);
	const normalizedRouteFamily = normalizeRoutingValue(routeFamily);
	if (!normalizedFamily || !normalizedRouteFamily) {
		return false;
	}
	if (normalizedFamily === normalizedRouteFamily) {
		return true;
	}
	return normalizedRouteFamily === "qwen"
		? isQwenLineageValue(normalizedFamily)
		: false;
}

export function modelRouteMatches(
	route: GatewayModelRoute,
	options: {
		modelId?: string;
		family?: string;
		capabilities?: readonly string[];
		operation?: ModelOperation;
		modalities?: import("@cline/shared").ModelModalities;
	},
): boolean {
	if (
		"requiredCapability" in route &&
		route.requiredCapability &&
		!options.capabilities?.includes(route.requiredCapability)
	) {
		return false;
	}

	switch (route.matcher) {
		case "anthropic-compatible":
			return isAnthropicCompatibleModel(options);
		case "model-operation":
			// Language is the canonical default; only specialized transports need
			// to declare an operation explicitly.
			return (options.operation ?? "language") === route.operation;
		case "model-output-modality":
			return options.modalities?.output.includes(route.modality) ?? false;
		case "model-family":
			return modelFamilyMatches(options.family, route.family);
		case "model-id":
			return (
				normalizeRoutingValue(options.modelId) ===
				normalizeRoutingValue(route.modelId)
			);
	}
}

export function providerReasoningRouteMatches(
	format: GatewayReasoningFormat,
	request: Pick<GatewayStreamRequest, "modelId">,
	context: GatewayProviderContext,
): boolean {
	const reasoning = context.provider.metadata?.routing?.reasoning;
	if (reasoning?.format !== format) {
		return false;
	}

	return reasoning.routes.some((route) =>
		modelRouteMatches(route, {
			modelId: request.modelId,
			family: resolveModelFamily(context),
			capabilities: context.model.capabilities,
		}),
	);
}

export function isGlmModel(
	request: Pick<GatewayStreamRequest, "modelId">,
	context: GatewayProviderContext,
): boolean {
	const family = normalizedFamily(context);

	// Dynamic provider fallback: some routed/local catalogs only provide ids.
	return family.includes("glm") || normalizedModelId(request).includes("glm");
}

export function isMiniMaxM3Model(
	request: Pick<GatewayStreamRequest, "modelId">,
	_context: GatewayProviderContext,
): boolean {
	const modelId = normalizedModelId(request);

	return modelId === "minimax-m3" || modelId === "minimax/minimax-m3";
}

export function isKimiK26Family(context: GatewayProviderContext): boolean {
	return normalizedFamily(context) === "kimi-k2.6";
}

export function isMoonshotKimiModelIdFallback(
	request: Pick<GatewayStreamRequest, "modelId">,
): boolean {
	// Dynamic provider fallback for Moonshot-routed model ids when family
	// metadata is absent or not specific enough.
	return normalizedModelId(request).includes("moonshotai/kimi-");
}

export function isDeepSeekFamily(context: GatewayProviderContext): boolean {
	return normalizedFamily(context).includes("deepseek");
}

/**
 * Whether the resolved model advertises image input (`"images"` in its
 * gateway capabilities). Models with no capability data at all (e.g. ids
 * resolved outside any catalog) fail open: images are kept rather than
 * hidden from a possibly capable model.
 */
export function modelSupportsImageInput(
	context: GatewayProviderContext,
): boolean {
	const capabilities = context.model.capabilities;
	if (!capabilities) {
		return true;
	}
	return capabilities.includes("images");
}

export function getReasoningDefaultOnMetadata(
	context: GatewayProviderContext,
): boolean | undefined {
	const value = context.model.metadata?.reasoningDefaultOn;
	return typeof value === "boolean" ? value : undefined;
}

export function isOllamaQwen3ModelIdFallback(
	request: Pick<GatewayStreamRequest, "providerId" | "modelId">,
): boolean {
	// Local Ollama models are discovered from /api/tags and often only provide
	// names such as "qwen3-coder:30b". This fallback is used by
	// modelReasoningDefaultsOn when no catalog metadata is present.
	return (
		request.providerId === "ollama" &&
		normalizedModelId(request).includes("qwen3")
	);
}

export function isCerebrasProvider(
	request: Pick<GatewayStreamRequest, "providerId">,
	context: GatewayProviderContext,
): boolean {
	const providerIds = [
		request.providerId,
		context.config.providerId,
		context.provider.id,
	].map((id) => id.toLowerCase());

	return (
		providerIds.includes("cerebras") ||
		isProviderBaseOrigin(context, "https://api.cerebras.ai")
	);
}

export function modelReasoningDefaultsOn(options: {
	request: Pick<GatewayStreamRequest, "providerId" | "modelId">;
	context: GatewayProviderContext;
}): boolean {
	return (
		getReasoningDefaultOnMetadata(options.context) ??
		isOllamaQwen3ModelIdFallback(options.request)
	);
}
