import type {
	GatewayProviderManifest,
	ModelOperation,
	ModelToolName,
} from "@cline/shared";
import { BUILTIN_PROVIDER_MANIFESTS_BY_ID } from "./builtins";
import { normalizeProviderId } from "./ids";
import { modelRouteMatches } from "./model-facts";

export interface ModelToolSupportInput {
	providerId: string;
	modelId?: string;
}

function resolveModelRouteContext(
	manifest: GatewayProviderManifest,
	modelId: string | undefined,
): {
	modelId: string;
	family?: string;
	capabilities?: readonly string[];
	operation?: ModelOperation;
	modalities?: import("@cline/shared").ModelModalities;
} {
	const resolvedModelId = modelId?.trim() || manifest.defaultModelId;
	const model = manifest.models.find((entry) => entry.id === resolvedModelId);
	const family = model?.metadata?.family;
	return {
		modelId: resolvedModelId,
		family: typeof family === "string" ? family : undefined,
		capabilities: model?.capabilities,
		operation: model?.operation,
		modalities: model?.modalities,
	};
}

/** Resolve a model-tool capability directly from a provider manifest. */
export function providerManifestSupportsModelTool(
	manifest: GatewayProviderManifest,
	modelId: string | undefined,
	toolName: ModelToolName,
): boolean {
	const capability = manifest.modelToolCapabilities?.find(
		(entry) => entry.name === toolName,
	);
	if (!capability) {
		return false;
	}

	const routeContext = resolveModelRouteContext(manifest, modelId);
	if (
		capability.routes?.length &&
		!capability.routes.some((route) => modelRouteMatches(route, routeContext))
	) {
		return false;
	}

	return !capability.excludeRoutes?.some((route) =>
		modelRouteMatches(route, routeContext),
	);
}

/**
 * Resolve stable native model-tool support for a configured Cline provider.
 * This intentionally describes provider execution support, not ordinary
 * function/tool calling support. Builtin specs are the source of truth; vendor
 * modules only translate supported portable tools into AI SDK tool objects.
 */
export function supportsModelTool(
	input: ModelToolSupportInput,
	toolName: ModelToolName,
): boolean {
	const providerId = normalizeProviderId(input.providerId);
	const manifest = BUILTIN_PROVIDER_MANIFESTS_BY_ID[providerId];
	return manifest
		? providerManifestSupportsModelTool(manifest, input.modelId, toolName)
		: false;
}

/**
 * Whether the provider declares the model tool for at least some of its
 * models, independent of the selected model. Settings surfaces use this to
 * explain provider-level availability; per-request attachment still resolves
 * through supportsModelTool with the selected model.
 */
export function providerOffersModelTool(
	providerId: string,
	toolName: ModelToolName,
): boolean {
	const manifest =
		BUILTIN_PROVIDER_MANIFESTS_BY_ID[normalizeProviderId(providerId)];
	return (
		manifest?.modelToolCapabilities?.some(
			(capability) => capability.name === toolName,
		) === true
	);
}
