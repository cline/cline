import type {
	GatewayModelRoute,
	GatewayProviderContext,
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

function normalizedModelId(request: Pick<GatewayStreamRequest, "modelId">): string {
	return normalizeRoutingValue(request.modelId) ?? "";
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
	return normalized ? /(^|[/:._-])qwen(?:$|[/:._-]|\d)/.test(normalized) : false;
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

export function isGlmModel(
	request: Pick<GatewayStreamRequest, "modelId">,
	context: GatewayProviderContext,
): boolean {
	const family = normalizedFamily(context);

	// Dynamic provider fallback: some routed/local catalogs only provide ids.
	return family.includes("glm") || normalizedModelId(request).includes("glm");
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

export function getReasoningDefaultOnMetadata(
	context: GatewayProviderContext,
): boolean | undefined {
	const value = context.model.metadata?.reasoningDefaultOn;
	return typeof value === "boolean" ? value : undefined;
}
