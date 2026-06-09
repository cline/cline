import * as LlmsModels from "@cline/llms";
import { isOAuthProvider } from "../../auth/provider-auth-registry";

export type ProviderConfigFieldKey =
	| "apiKey"
	| "baseUrl"
	| "azureApiVersion"
	| "headers"
	| "contextWindow"
	| "maxOutputTokens"
	| "awsRegion"
	| "awsProfile"
	| "gcpProjectId"
	| "gcpRegion"
	| "sapClientId"
	| "sapClientSecret"
	| "sapTokenUrl"
	| "sapResourceGroup"
	| "sapDeploymentId";

export interface ProviderConfigFieldRequirement {
	defaultValue?: string;
	label?: string;
	note?: string;
	placeholder?: string;
	optional?: boolean;
}

export interface ProviderConfigFields {
	providerId: string;
	authMethod: "api-key" | "oauth" | "local";
	fields: Partial<
		Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
	>;
	/** Optional description shown above the fields (e.g. AWS region auto-fill hint). */
	description?: string;
}

const FIELD_KEYS: ProviderConfigFieldKey[] = [
	"apiKey",
	"baseUrl",
	"azureApiVersion",
	"headers",
	"contextWindow",
	"maxOutputTokens",
	"awsRegion",
	"awsProfile",
	"gcpProjectId",
	"gcpRegion",
	"sapClientId",
	"sapClientSecret",
	"sapTokenUrl",
	"sapResourceGroup",
	"sapDeploymentId",
];

interface ProviderConfigFieldMetadata {
	description?: string;
	fields: Partial<
		Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
	>;
	mode?: "merge" | "replace";
}

const PROVIDER_CONFIG_FIELD_METADATA: Partial<
	Record<string, ProviderConfigFieldMetadata>
> = {
	"openai-compatible": {
		description:
			"For Azure AI Foundry deployments, use a Base URL ending at /openai/deployments/<deployment> and set the Azure API version.",
		fields: {
			azureApiVersion: {
				label: "Azure API Version (optional)",
				placeholder: "2025-01-01-preview",
				note: "Required for Azure AI Foundry deployment URLs.",
				optional: true,
			},
		},
	},
	vertex: {
		mode: "replace",
		description:
			"Vertex AI can use Google Cloud Application Default Credentials with a project/region. An API key is optional for supported Gemini models.",
		fields: {
			gcpProjectId: {
				label: "Google Cloud Project ID",
				placeholder: "my-gcp-project",
			},
			gcpRegion: {
				label: "Google Cloud Region",
				placeholder: "us-central1",
				defaultValue: "us-central1",
			},
			apiKey: {
				label: "API Key (optional)",
				placeholder: "Leave blank to use Google Cloud credentials",
				optional: true,
			},
		},
	},
	bedrock: {
		mode: "replace",
		description:
			"AWS region is required for Bedrock. It can be auto-filled from AWS_REGION, AWS_DEFAULT_REGION, or ~/.aws/config.",
		fields: {
			awsRegion: {
				label: "AWS Region",
				placeholder: "us-east-1",
			},
			apiKey: {
				label: "AWS Bedrock API Key (optional)",
				placeholder: "Leave blank to use AWS profile/default chain",
				optional: true,
			},
			awsProfile: {
				label: "AWS Profile Name (optional)",
				placeholder: "default",
				optional: true,
			},
		},
	},
	ollama: {
		fields: {
			apiKey: {
				note: "Keep empty if no API key for local inference.",
			},
		},
	},
	"openai-compatible": {
		fields: {
			headers: {
				label: "Custom Headers (optional)",
				placeholder: "X-Header=value, X-Other=value",
				optional: true,
			},
			contextWindow: {
				label: "Context Window (optional)",
				placeholder: "e.g. 128000",
				optional: true,
			},
			maxOutputTokens: {
				label: "Max Output Tokens (optional)",
				placeholder: "e.g. 8192",
				optional: true,
			},
		},
	},
	sapaicore: {
		mode: "replace",
		description:
			"SAP AI Core uses OAuth client credentials and an AI Core API URL, not a generic API key.",
		fields: {
			baseUrl: {
				label: "AI Core Base URL",
				placeholder: "https://api.ai.<region>.aws.ml.hana.ondemand.com",
			},
			sapClientId: {
				label: "Client ID",
				placeholder: "sb-...|xsuaa_std!b...",
			},
			sapClientSecret: {
				label: "Client Secret",
				placeholder: "SAP AI Core client secret",
			},
			sapTokenUrl: {
				label: "Token URL",
				placeholder: "https://<subdomain>.authentication.sap.hana.ondemand.com",
			},
			sapResourceGroup: {
				label: "Resource Group",
				placeholder: "default",
				optional: true,
			},
			sapDeploymentId: {
				label: "Deployment ID",
				placeholder: "SAP AI Core deployment id",
				optional: true,
			},
		},
	},
};

function mergeFields(
	baseFields: ProviderConfigFields["fields"],
	metadataFields: ProviderConfigFieldMetadata["fields"],
): ProviderConfigFields["fields"] {
	const fields: ProviderConfigFields["fields"] = {};
	for (const field of FIELD_KEYS) {
		const base = baseFields[field];
		const metadata = metadataFields[field];
		if (base || metadata) fields[field] = { ...base, ...metadata };
	}
	return fields;
}

function applyProviderConfigFieldMetadata(
	config: ProviderConfigFields,
): ProviderConfigFields {
	const metadata = PROVIDER_CONFIG_FIELD_METADATA[config.providerId];
	if (!metadata) return config;

	return {
		...config,
		description: metadata.description ?? config.description,
		fields:
			metadata.mode === "replace"
				? metadata.fields
				: mergeFields(config.fields, metadata.fields),
	};
}

const EDITABLE_BASE_URL_PROVIDER_IDS = new Set([
	"ollama",
	"lmstudio",
	"litellm",
	"openai-compatible",
]);

function shouldExposeBaseUrlField(
	providerId: string,
	collection: LlmsModels.ModelCollection | undefined,
): boolean {
	if (!collection?.provider.baseUrl) return false;
	if (collection.provider.source !== "system") return true;
	return EDITABLE_BASE_URL_PROVIDER_IDS.has(providerId);
}

/**
 * Project a provider into the inputs a configure-dialog should render.
 *
 * No fields are marked "required". `llms` no longer pre-flights credentials,
 * so a missing API key surfaces as the provider's own auth error rather than
 * a synthetic SDK failure. UIs may still require fields client-side if they
 * want, but the runtime does not.
 *
 * - OAuth providers (`cline`, `oca`, `openai-codex`) return `authMethod:
 *   "oauth"` with no fields; the configure UI should route to the OAuth
 *   login flow instead.
 * - Local auth providers return `authMethod: "local"` with no fields. The
 *   configure UI should show provider-specific local readiness instead.
 * - All other providers return `apiKey`. Built-in local/proxy-style providers
 *   with user-supplied endpoints, plus user-added providers with saved
 *   endpoints, also return a pre-filled `baseUrl` field.
 *
 * Returns the same fallback shape for unknown providers (single `apiKey`
 * input, no default base URL) so callers can render a reasonable configure
 * dialog without per-id branches.
 */
export function getProviderConfigFields(
	providerId: string,
): ProviderConfigFields {
	const id = LlmsModels.normalizeProviderId(providerId);
	if (isOAuthProvider(id)) {
		return { providerId: id, authMethod: "oauth", fields: {} };
	}

	const collection = LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID[id];
	if (collection?.provider.capabilities?.includes("local-auth")) {
		return { providerId: id, authMethod: "local", fields: {} };
	}

	const defaultBaseUrl = collection?.provider.baseUrl;
	const fields: ProviderConfigFields["fields"] = {
		apiKey: {},
	};
	if (shouldExposeBaseUrlField(id, collection)) {
		fields.baseUrl = { defaultValue: defaultBaseUrl };
	}

	return applyProviderConfigFieldMetadata({
		providerId: id,
		authMethod: "api-key",
		fields,
	});
}
