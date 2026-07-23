import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayReasoningFormat,
	GatewayStreamRequest,
} from "@cline/shared";

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

export function isGemini3Model(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): boolean {
	return /(^|[/\s])gemini-3([.-]|$)/.test(geminiModelDescriptor(input));
}

export function isGeminiProModel(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): boolean {
	return /(^|[/\s])gemini-2\.5-pro([-\s]|$)/.test(geminiModelDescriptor(input));
}

export function isGeminiFlashModel(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): boolean {
	const descriptor = geminiModelDescriptor(input);
	return (
		/(^|[/\s])gemini-(?:\d(?:\.\d)?-)?flash(?:-lite|-image)?([-\s]|$)/.test(
			descriptor,
		) || descriptor.includes("gemini-flash")
	);
}

export function supportsGeminiThinking(input: {
	request: Pick<GatewayStreamRequest, "modelId">;
	context: GatewayProviderContext;
}): boolean {
	const descriptor = geminiModelDescriptor(input);
	return (
		isGemini3Model(input) ||
		/(^|[/\s])gemini-2\.5([-\s]|$)/.test(descriptor) ||
		descriptor.includes("gemini-flash-latest")
	);
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
	const family = normalizedFamily(context);
	return (
		family === "deepseek" ||
		family === "deepseek-thinking" ||
		family === "deepseek-flash"
	);
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
