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
	return normalized || undefined;
}

function isAnthropicLineageValue(value: string | undefined): boolean {
	const normalized = normalizeRoutingValue(value);
	return normalized
		? normalized.includes("anthropic") || normalized.includes("claude")
		: false;
}

export function isAnthropicCompatibleModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	return options.family
		? isAnthropicLineageValue(options.family)
		: isAnthropicLineageValue(options.modelId);
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
			return (
				normalizeRoutingValue(options.family) ===
				normalizeRoutingValue(route.family)
			);
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
	return (
		reasoning?.format === format &&
		reasoning.routes.some((route) =>
			modelRouteMatches(route, {
				modelId: request.modelId,
				family: resolveModelFamily(context),
				capabilities: context.model.capabilities,
			}),
		)
	);
}
