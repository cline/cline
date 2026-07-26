import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import type { BedrockConnection } from "../config";
import {
	createBedrockTransport,
	validateBedrockConnection,
} from "../bedrock-transport";
import type { ProviderFactoryResult } from "./types";

type BedrockCredentials = {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
};

type BedrockCredentialProvider = () => PromiseLike<BedrockCredentials>;

function readConnection(config: GatewayResolvedProviderConfig): {
	connection: BedrockConnection;
	workspaceRoot?: string;
} {
	const raw = config.options?.connection as Partial<BedrockConnection> | undefined;
	if (!raw || typeof raw.region !== "string") {
		throw new Error("BEDROCK_REGION: Enter a valid AWS region.");
	}
	return {
		connection: validateBedrockConnection({
			region: raw.region,
			profile: typeof raw.profile === "string" ? raw.profile : undefined,
			endpoint: typeof raw.endpoint === "string" ? raw.endpoint : undefined,
			caBundlePath:
				typeof raw.caBundlePath === "string" ? raw.caBundlePath : undefined,
		}),
		workspaceRoot:
			typeof config.options?.workspaceRoot === "string"
				? config.options.workspaceRoot
				: undefined,
	};
}

export async function createBedrockProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const { connection, workspaceRoot } = readConnection(config);
	const transport = await createBedrockTransport(connection, workspaceRoot);
	const clientConfig = {
		region: connection.region,
		...(transport.requestHandler
			? { requestHandler: transport.requestHandler }
			: {}),
	};
	const credentialProvider: BedrockCredentialProvider = connection.profile
		? fromNodeProviderChain({
				profile: connection.profile,
				ignoreCache: true,
				clientConfig,
			})
		: fromNodeProviderChain({ clientConfig });

	const provider = createAmazonBedrock({
		region: connection.region,
		baseURL: connection.endpoint,
		fetch: transport.fetch,
		credentialProvider,
	});

	return {
		model: (modelId) => provider(modelId),
	};
}
