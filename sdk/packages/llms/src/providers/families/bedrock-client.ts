import type { ProviderConfig } from "../types";

type BedrockFactory = (modelId: string) => unknown;

let cachedCreateAmazonBedrock:
	| ((options: {
			region?: string;
			accessKeyId?: string;
			secretAccessKey?: string;
			sessionToken?: string;
			apiKey?: string;
			baseURL?: string;
			headers?: Record<string, string>;
			credentialProvider?: () => PromiseLike<{
				accessKeyId: string;
				secretAccessKey: string;
				sessionToken?: string;
			}>;
	  }) => BedrockFactory)
	| undefined;

let cachedFromNodeProviderChain:
	| ((options?: { profile?: string }) => () => PromiseLike<{
			accessKeyId: string;
			secretAccessKey: string;
			sessionToken?: string;
	  }>)
	| undefined;

async function loadCreateAmazonBedrock() {
	if (cachedCreateAmazonBedrock) {
		return cachedCreateAmazonBedrock;
	}

	const moduleName = "@ai-sdk/amazon-bedrock";
	const mod = (await import(moduleName)) as {
		createAmazonBedrock?: typeof cachedCreateAmazonBedrock;
	};
	if (!mod.createAmazonBedrock) {
		throw new Error(`Failed to load createAmazonBedrock from ${moduleName}`);
	}

	cachedCreateAmazonBedrock = mod.createAmazonBedrock;
	return cachedCreateAmazonBedrock;
}

async function loadFromNodeProviderChain() {
	if (cachedFromNodeProviderChain) {
		return cachedFromNodeProviderChain;
	}

	const moduleName = "@aws-sdk/credential-providers";
	const mod = (await import(moduleName)) as {
		fromNodeProviderChain?: typeof cachedFromNodeProviderChain;
	};
	if (!mod.fromNodeProviderChain) {
		throw new Error(`Failed to load fromNodeProviderChain from ${moduleName}`);
	}

	cachedFromNodeProviderChain = mod.fromNodeProviderChain;
	return cachedFromNodeProviderChain;
}

export async function createBedrockClient(
	config: ProviderConfig,
	defaultHeaders: Record<string, string>,
): Promise<BedrockFactory> {
	const createAmazonBedrock = await loadCreateAmazonBedrock();

	const region = config.region ?? "us-east-1";
	const authentication = config.aws?.authentication;
	const hasExplicitKeys = Boolean(
		config.aws?.accessKey && config.aws?.secretKey,
	);
	const shouldUseCredentialChain =
		authentication === "profile" ||
		authentication === "iam" ||
		(!authentication && !hasExplicitKeys && !config.apiKey);

	let credentialProvider:
		| ReturnType<Exclude<typeof cachedFromNodeProviderChain, undefined>>
		| undefined;
	if (shouldUseCredentialChain) {
		const fromNodeProviderChain = await loadFromNodeProviderChain();
		credentialProvider = fromNodeProviderChain({
			profile: config.aws?.profile,
		});
	}

	return createAmazonBedrock({
		region,
		accessKeyId: config.aws?.accessKey ?? undefined,
		secretAccessKey: config.aws?.secretKey ?? undefined,
		sessionToken: config.aws?.sessionToken ?? undefined,
		apiKey: config.apiKey ?? undefined,
		baseURL: config.aws?.endpoint ?? config.baseUrl ?? undefined,
		headers: defaultHeaders,
		credentialProvider,
	});
}
