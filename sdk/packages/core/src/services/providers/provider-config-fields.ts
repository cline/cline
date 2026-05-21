import * as LlmsModels from "@cline/llms";
import { isOAuthProviderId } from "@cline/shared";

export type ProviderConfigFieldKey =
	| "apiKey"
	| "baseUrl"
	| "awsRegion"
	| "awsProfile";

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
	"awsRegion",
	"awsProfile",
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
	if (isOAuthProviderId(id)) {
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
