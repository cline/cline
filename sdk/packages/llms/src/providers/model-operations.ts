import type {
	GatewayModelDefinition,
	GatewayModelOperationCapability,
	GatewayProviderManifest,
	ModelModalities,
	ModelOperation,
} from "@cline/shared";
import { modelRouteMatches } from "./model-facts";

const IMAGE_LANGUAGE_OPERATION: GatewayModelOperationCapability = {
	operation: "language",
	outputModalities: ["text", "image"],
};

const IMAGE_GENERATION_OPERATION: GatewayModelOperationCapability = {
	operation: "image-generation",
	inputModalities: ["text", "image"],
	outputModalities: ["image"],
};

/**
 * Built-in transports that have an explicitly verified non-text operation.
 *
 * Provider family is intentionally not consulted. In particular, an
 * OpenAI-compatible chat endpoint does not imply support for the separate
 * `/images/generations` transport. New providers opt in here only after their
 * concrete adapter implements the operation.
 */
export const BUILTIN_MODEL_OPERATION_CAPABILITIES: Readonly<
	Record<string, readonly GatewayModelOperationCapability[]>
> = {
	"openai-native": [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	gemini: [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	vertex: [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	bedrock: [IMAGE_GENERATION_OPERATION],
	openrouter: [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	"vercel-ai-gateway": [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	digitalocean: [IMAGE_GENERATION_OPERATION],
	xai: [IMAGE_GENERATION_OPERATION],
	cline: [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
	"cline-pass": [IMAGE_LANGUAGE_OPERATION, IMAGE_GENERATION_OPERATION],
};

export function resolveModelOperation(model: {
	operation?: ModelOperation;
}): ModelOperation {
	return model.operation ?? "language";
}

function includesAll<T>(
	available: readonly T[] | undefined,
	required: readonly T[] | undefined,
): boolean {
	return (
		available === undefined ||
		required === undefined ||
		required.length === 0 ||
		required.every((value) => available.includes(value))
	);
}

interface OperationModelDescriptor {
	id: string;
	operation?: ModelOperation;
	modalities?: ModelModalities;
	capabilities?: readonly string[];
	metadata?: GatewayModelDefinition["metadata"];
}

function capabilityRoutesMatchModel(
	capability: GatewayModelOperationCapability,
	model: OperationModelDescriptor,
): boolean {
	const family = model.metadata?.family;
	const routeContext = {
		modelId: model.id,
		family: typeof family === "string" ? family : undefined,
		capabilities: model.capabilities,
		operation: resolveModelOperation(model),
		modalities: model.modalities,
	};
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

function capabilityMatchesModel(
	capability: GatewayModelOperationCapability,
	model: OperationModelDescriptor,
): boolean {
	const operation = resolveModelOperation(model);
	const outputModalities =
		operation === "language"
			? model.modalities?.output
			: model.modalities?.output.filter((modality) => modality !== "text");
	if (!capabilityRoutesMatchModel(capability, model)) {
		return false;
	}
	return (
		includesAll(capability.inputModalities, model.modalities?.input) &&
		includesAll(capability.outputModalities, outputModalities)
	);
}

function operationCapabilitiesSupportModel(
	capabilities: readonly GatewayModelOperationCapability[] | undefined,
	model: OperationModelDescriptor,
): boolean {
	const operation = resolveModelOperation(model);
	const needsExplicitCapability =
		operation !== "language" ||
		model.modalities?.output.some((modality) => modality !== "text") === true;
	if (!needsExplicitCapability) return true;

	return (
		capabilities?.some(
			(capability) =>
				capability.operation === operation &&
				capabilityMatchesModel(capability, model),
		) ?? false
	);
}

/**
 * Constrain external catalog facts to the modalities implemented by the
 * selected built-in transport. Catalogs may advertise additional endpoint
 * features (for example PDF output on an image model) that the SDK does not
 * request or decode. The stored model must describe the executable subset.
 */
export function normalizeBuiltinModelOperationModalities(input: {
	providerId: string;
	modelId: string;
	operation?: ModelOperation;
	modalities?: ModelModalities;
	family?: string;
	capabilities?: readonly string[];
}): ModelModalities | undefined {
	if (!input.modalities) return undefined;
	const model: OperationModelDescriptor = {
		id: input.modelId,
		operation: input.operation,
		modalities: input.modalities,
		capabilities: input.capabilities,
		metadata: input.family ? { family: input.family } : undefined,
	};
	const capability = BUILTIN_MODEL_OPERATION_CAPABILITIES[
		input.providerId
	]?.find(
		(candidate) =>
			candidate.operation === resolveModelOperation(model) &&
			capabilityRoutesMatchModel(candidate, model),
	);
	if (!capability) return input.modalities;

	const intersect = <T>(
		declared: readonly T[],
		supported: readonly T[] | undefined,
	): T[] =>
		supported === undefined
			? [...declared]
			: declared.filter((value) => supported.includes(value));
	const inputModalities = intersect(
		input.modalities.input,
		capability.inputModalities,
	);
	const outputModalities = intersect(
		input.modalities.output,
		capability.outputModalities,
	);

	// Preserve an unmatchable declaration so the fail-closed support check can
	// reject it instead of turning an empty intersection into apparent support.
	if (inputModalities.length === 0 || outputModalities.length === 0) {
		return input.modalities;
	}
	return { input: inputModalities, output: outputModalities };
}

/** Resolve a model operation directly from a provider manifest. */
export function providerManifestSupportsModelOperation(
	manifest: Pick<
		GatewayProviderManifest,
		"modelOperationCapabilities" | "models"
	>,
	model: Pick<
		GatewayModelDefinition,
		"id" | "operation" | "modalities" | "capabilities" | "metadata"
	>,
): boolean {
	return operationCapabilitiesSupportModel(
		manifest.modelOperationCapabilities,
		model,
	);
}

/** Catalog-time form of the same fail-closed transport capability check. */
export function builtinProviderSupportsModelOperation(input: {
	providerId: string;
	modelId: string;
	operation?: ModelOperation;
	modalities?: ModelModalities;
	family?: string;
	capabilities?: readonly string[];
}): boolean {
	const capabilities = BUILTIN_MODEL_OPERATION_CAPABILITIES[input.providerId];
	return operationCapabilitiesSupportModel(capabilities, {
		id: input.modelId,
		operation: input.operation,
		modalities: input.modalities,
		capabilities: input.capabilities,
		metadata: input.family ? { family: input.family } : undefined,
	});
}
