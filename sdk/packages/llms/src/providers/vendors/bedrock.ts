import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { GatewayResolvedProviderConfig } from "@bedrock-coder/shared";
import {
	createBedrockTransport,
	createBedrockCredentialProvider,
	validateBedrockConnection,
} from "../bedrock-transport";
import type { BedrockConnection } from "../config";
import type { ProviderFactoryResult } from "./types";

function readConnection(config: GatewayResolvedProviderConfig): {
	connection: BedrockConnection;
	workspaceRoot?: string;
} {
	const raw = config.options?.connection as
		| Partial<BedrockConnection>
		| undefined;
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
			controlPlaneEndpoint:
				typeof raw.controlPlaneEndpoint === "string"
					? raw.controlPlaneEndpoint
					: undefined,
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
	const credentialProvider = createBedrockCredentialProvider(
		connection,
		transport,
	);

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
