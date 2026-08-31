import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { getGeneratedModelsForProvider } from "../../catalog/catalog.generated-access";
import type { ProviderFactoryResult } from "./types";

type BedrockCredentials = {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
};

type BedrockCredentialProvider = () => PromiseLike<BedrockCredentials>;

type BedrockAuthentication = "iam" | "api-key" | "apikey" | "profile";

// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock
const NON_BEDROCK_API_KEY_ENV = new Set([
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"AWS_PROFILE",
]);

// Bedrock inference-profile model-id resolution.
//
// AWS Bedrock offers no on-demand throughput for newer foundation models:
// they must be invoked through an inference profile — either a geo-prefixed
// system profile id ("us." / "eu." / "apac." / "jp." / "au." / "global.") or
// a provisioned profile ARN. Invoking the bare foundation-model id fails with
// "Invocation of model ID ... with on-demand throughput isn't supported.
// Retry your request with the ID or ARN of an inference profile that contains
// this model."
// https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
//
// This mirrors the legacy extension's cross-region inference support
// (legacy-extension branch, apps/vscode/src/core/api/providers/bedrock.ts):
// the user's `useCrossRegionInference` / `useGlobalInference` settings are
// honored, and bare ids of models known to have no on-demand throughput are
// additionally auto-prefixed so they work without the toggle.

const BEDROCK_GEO_PROFILE_PREFIX_PATTERN =
	/^(?:us|us-gov|eu|apac|jp|au|ca|sa|global)\./;

// Documented fallback-heuristic exception (see packages/llms/AGENTS.md):
// a maintained, intentionally narrow id-pattern list of foundation-model
// families that have no on-demand throughput on Bedrock. A match only makes
// the model eligible for profile routing without the cross-region setting;
// the actual prefix is always taken from a catalog-confirmed profile variant,
// so a match cannot manufacture an id or break a working configuration.
// Models missing from the list keep working through the cross-region
// inference setting.
const BEDROCK_INFERENCE_PROFILE_REQUIRED_PATTERNS: readonly RegExp[] = [
	// Every Anthropic model since Claude 3.7 launched profile-only, and all of
	// them use tier-first naming (claude-sonnet-4-6, claude-opus-5,
	// claude-haiku-4-5-..., claude-fable-5, ...). Match tier-first ids by
	// excluding the frozen set of legacy naming schemes (claude-3-5-sonnet-...,
	// claude-v2, claude-instant-v1) so future tiers work without list updates.
	/^anthropic\.claude-(?![0-9]|v[0-9]|instant)/,
	// Claude 3.7 predates tier-first naming but launched profile-only.
	/^anthropic\.claude-3-7-/,
	/^amazon\.nova-(?:2|micro|lite|pro|premier)/,
	/^deepseek\./,
	/^meta\.llama3-[23]-/,
	/^meta\.llama4-/,
	/^mistral\.pixtral-large-/,
];

const JP_INFERENCE_PROFILE_REGIONS = new Set([
	"ap-northeast-1",
	"ap-northeast-3",
]);

const AU_INFERENCE_PROFILE_REGIONS = new Set([
	"ap-southeast-2",
	"ap-southeast-4",
]);

interface BedrockModelIdOptions {
	region?: string;
	useCrossRegionInference?: boolean;
	useGlobalInference?: boolean;
	/** Catalog membership probe; overridable in tests. */
	hasCatalogModel?: (modelId: string) => boolean;
}

/**
 * Resolves the model id sent to Bedrock, prepending a geo inference-profile
 * prefix derived from the configured AWS region when required.
 *
 * Ids that are already profile-prefixed and ARNs (provisioned throughput,
 * imported/custom models, application inference profiles) are always passed
 * through unmodified. Ids without a known matching profile are kept raw
 * rather than manufacturing a profile id that may not exist — AWS's
 * on-demand error is more actionable than "provided model identifier is
 * invalid".
 */
export function resolveBedrockModelId(
	modelId: string,
	options: BedrockModelIdOptions,
): string {
	if (
		modelId.startsWith("arn:") ||
		BEDROCK_GEO_PROFILE_PREFIX_PATTERN.test(modelId)
	) {
		return modelId;
	}

	const hasCatalogModel = options.hasCatalogModel ?? hasBedrockCatalogModel;
	const useCrossRegionInference = options.useCrossRegionInference === true;
	const requiresInferenceProfile =
		BEDROCK_INFERENCE_PROFILE_REQUIRED_PATTERNS.some((pattern) =>
			pattern.test(modelId),
		);
	if (!useCrossRegionInference && !requiresInferenceProfile) {
		return modelId;
	}

	if (
		useCrossRegionInference &&
		options.useGlobalInference === true &&
		hasCatalogModel(`global.${modelId}`)
	) {
		return `global.${modelId}`;
	}

	// Use the first profile variant the catalog confirms exists for the
	// region's candidates. AWS documents inference-profile availability per
	// model and geography, so an unconfirmed geographic prefix is never
	// assumed valid; without a confirmed variant the raw id is preserved.
	// This also keeps custom/provisioned model ids raw on the cross-region
	// path: they are not catalog models, so no variant matches.
	for (const prefix of geoProfileCandidates(options.region)) {
		if (hasCatalogModel(`${prefix}${modelId}`)) {
			return `${prefix}${modelId}`;
		}
	}
	return modelId;
}

function geoProfileCandidates(region: string | undefined): string[] {
	if (!region) {
		return [];
	}
	if (region.startsWith("us-gov-")) {
		return ["us-gov."];
	}
	if (region.startsWith("us-")) {
		return ["us."];
	}
	if (region.startsWith("eu-")) {
		return ["eu."];
	}
	if (region.startsWith("ap-")) {
		// AWS ships dedicated jp./au. profiles — and often no apac. profile —
		// for the newest Claude models, so prefer the country profile where the
		// region allows it.
		if (JP_INFERENCE_PROFILE_REGIONS.has(region)) {
			return ["jp.", "apac."];
		}
		if (AU_INFERENCE_PROFILE_REGIONS.has(region)) {
			return ["au.", "apac."];
		}
		return ["apac."];
	}
	// Geo inference profiles are not mapped for other regions.
	return [];
}

function hasBedrockCatalogModel(modelId: string): boolean {
	return modelId in getGeneratedModelsForProvider("bedrock");
}

export async function createBedrockProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const authentication = readAuthentication(config.options?.authentication);
	const usesApiKeyAuth =
		authentication === "api-key" || authentication === "apikey";
	const hasDirectCredentials =
		readOptionalString(config.options?.accessKeyId) !== undefined &&
		readOptionalString(config.options?.secretAccessKey) !== undefined;
	const hasProfile = readOptionalString(config.options?.profile) !== undefined;
	const usesExplicitSigV4Auth =
		!usesApiKeyAuth &&
		(authentication === "iam" || authentication === "profile" || hasProfile);
	const apiKey = usesExplicitSigV4Auth
		? undefined
		: await resolveBedrockApiKey(config, {
				includeEnvironment: usesApiKeyAuth || !hasDirectCredentials,
			});
	const credentialProvider = resolveCredentialProvider(config, {
		authentication,
		apiKey,
		hasDirectCredentials,
		hasProfile,
	});
	const usesSigV4 =
		authentication === "iam" ||
		authentication === "profile" ||
		hasDirectCredentials ||
		credentialProvider !== undefined;

	const provider = createAmazonBedrock({
		region: readOptionalString(config.options?.region),
		apiKey: usesApiKeyAuth
			? (apiKey ?? "")
			: (apiKey ?? (usesSigV4 ? "" : undefined)),
		accessKeyId: credentialProvider
			? undefined
			: readOptionalString(config.options?.accessKeyId),
		secretAccessKey: credentialProvider
			? undefined
			: readOptionalString(config.options?.secretAccessKey),
		sessionToken: credentialProvider
			? undefined
			: readOptionalString(config.options?.sessionToken),
		baseURL: config.baseUrl ?? readOptionalString(config.options?.endpoint),
		headers: config.headers,
		fetch: config.fetch,
		credentialProvider,
	});

	const modelIdOptions: BedrockModelIdOptions = {
		region:
			readOptionalString(config.options?.region) ??
			readOptionalString(process.env.AWS_REGION) ??
			readOptionalString(process.env.AWS_DEFAULT_REGION),
		useCrossRegionInference: config.options?.useCrossRegionInference === true,
		useGlobalInference: config.options?.useGlobalInference === true,
	};

	return {
		operations: {
			language: (modelId) =>
				provider(resolveBedrockModelId(modelId, modelIdOptions)),
			imageGeneration: (modelId) => provider.image(modelId),
		},
	};
}

function resolveCredentialProvider(
	config: GatewayResolvedProviderConfig,
	options: {
		authentication: BedrockAuthentication | undefined;
		apiKey: string | undefined;
		hasDirectCredentials: boolean;
		hasProfile: boolean;
	},
): BedrockCredentialProvider | undefined {
	const region = readOptionalString(config.options?.region);
	if (typeof config.options?.credentialProvider === "function") {
		return config.options.credentialProvider as BedrockCredentialProvider;
	}

	if (
		options.authentication === "api-key" ||
		options.authentication === "apikey" ||
		options.apiKey
	) {
		return undefined;
	}

	if (options.authentication === "profile" || options.hasProfile) {
		const profile = readOptionalString(config.options?.profile);
		return fromNodeProviderChain({
			ignoreCache: true,
			...(profile ? { profile } : {}),
			...(region ? { clientConfig: { region } } : {}),
		});
	}

	if (options.hasDirectCredentials) {
		return undefined;
	}

	return region
		? fromNodeProviderChain({ clientConfig: { region } })
		: fromNodeProviderChain();
}

async function resolveBedrockApiKey(
	config: GatewayResolvedProviderConfig,
	options: { includeEnvironment: boolean },
): Promise<string | undefined> {
	const explicitApiKey =
		readOptionalString(config.apiKey) ??
		readOptionalString(config.options?.apiKey) ??
		readOptionalString(config.options?.bedrockApiKey) ??
		readOptionalString(config.options?.awsBedrockApiKey);
	if (explicitApiKey) {
		return explicitApiKey;
	}

	const resolvedApiKey = readOptionalString(await config.apiKeyResolver?.());
	if (resolvedApiKey) {
		return resolvedApiKey;
	}

	if (!options.includeEnvironment) {
		return undefined;
	}

	for (const key of config.apiKeyEnv ?? []) {
		if (NON_BEDROCK_API_KEY_ENV.has(key)) {
			continue;
		}
		const value = readOptionalString(process.env[key]);
		if (value) {
			return value;
		}
	}

	return readOptionalString(process.env.AWS_BEARER_TOKEN_BEDROCK);
}

function readAuthentication(value: unknown): BedrockAuthentication | undefined {
	return value === "iam" ||
		value === "api-key" ||
		value === "apikey" ||
		value === "profile"
		? value
		: undefined;
}

function readOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
