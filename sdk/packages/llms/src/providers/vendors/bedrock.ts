import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
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

function withTemporaryAwsRegion<R>(
	region: string | undefined,
	fn: () => Promise<R>,
): Promise<R> {
	if (!region) return fn();

	const previousAwsRegion = process.env.AWS_REGION;
	process.env.AWS_REGION = region;

	return Promise.resolve(fn()).finally(() => {
		if (previousAwsRegion === undefined) {
			delete process.env.AWS_REGION;
		} else {
			process.env.AWS_REGION = previousAwsRegion;
		}
	});
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

	return {
		model: (modelId) => provider(modelId),
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
		const region = readOptionalString(config.options?.region);
		const providerChain = fromNodeProviderChain({
			ignoreCache: true,
			...(profile ? { profile } : {}),
		});
		return () => withTemporaryAwsRegion(region, () => providerChain());
	}

	if (options.hasDirectCredentials) {
		return undefined;
	}

	return fromNodeProviderChain();
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
