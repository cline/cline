import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import { modelRouteMatches, resolveModelFamily } from "../model-facts";

/**
 * Bedrock's Converse API expresses prompt-cache checkpoints as dedicated
 * `cachePoint` content blocks. `@ai-sdk/amazon-bedrock` only emits them from
 * `providerOptions.bedrock.cachePoint` markers and silently drops the
 * Anthropic `cache_control` dialect, so Bedrock needs its own prompt-cache
 * wire format.
 */
export const BEDROCK_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		promptCache: {
			format: "bedrock-cache-point",
			routes: [{ matcher: "anthropic-compatible" }],
		},
		reasoning: {
			format: "anthropic-thinking",
			routes: [{ matcher: "anthropic-compatible" }],
		},
	},
};

export function resolveBedrockCachePointRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	const promptCache = context.provider.metadata?.routing?.promptCache;
	if (promptCache?.format !== "bedrock-cache-point") {
		return undefined;
	}

	return promptCache.routes.find((route) =>
		modelRouteMatches(route, {
			modelId: request.modelId,
			family: resolveModelFamily(context),
			capabilities: context.model.capabilities,
		}),
	);
}

export function shouldApplyBedrockCachePoint(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return resolveBedrockCachePointRoute(request, context) !== undefined;
}

export function createBedrockCachePointProviderOptions() {
	return {
		bedrock: { cachePoint: { type: "default" as const } },
	};
}

/**
 * Attach a message-level cache-point marker to the last user message. The
 * Bedrock message converter appends the `cachePoint` block after that
 * message's content, caching the whole prefix (tools, system, and history)
 * up to it — mirroring the Anthropic writer's checkpoint placement.
 */
export function applyBedrockCachePointToLastUserMessage(
	messages: Array<Record<string, unknown>>,
): void {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") {
			continue;
		}
		message.providerOptions = {
			...(message.providerOptions as Record<string, unknown> | undefined),
			...createBedrockCachePointProviderOptions(),
		};
		return;
	}
}
