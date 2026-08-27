import * as LlmsModels from "@cline/llms";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
} from "../../auth/provider-auth-registry";
import type {
	ProviderConfig,
	ProviderSettings,
} from "../llms/provider-settings";
import { getProviderConfigFields } from "./provider-config-fields";

function hasText(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasAwsCredentials(settings: ProviderSettings): boolean {
	const aws = settings.aws;
	if (!aws) {
		return false;
	}
	if (aws.authentication === "iam" || aws.authentication === "profile") {
		return true;
	}
	if (hasText(aws.profile)) {
		return true;
	}
	return hasText(aws.accessKey) && hasText(aws.secretKey);
}

function hasAwsRegion(settings: ProviderSettings): boolean {
	return hasText(settings.aws?.region ?? settings.region);
}

function hasGcpCredentials(settings: ProviderSettings): boolean {
	const gcp = settings.gcp;
	// Vertex defaults to us-central1 at runtime when no region is stored, so keep
	// existing project-only configs usable while new saves include a region.
	return hasText(gcp?.projectId);
}

function hasAzureCredentials(settings: ProviderSettings): boolean {
	return settings.azure?.useIdentity === true;
}

function hasSapCredentials(settings: ProviderSettings): boolean {
	const sap = settings.sap;
	return (
		hasText(sap?.clientId) &&
		hasText(sap?.clientSecret) &&
		hasText(sap?.tokenUrl) &&
		hasText(settings.baseUrl)
	);
}

/**
 * Whether persisted provider settings hold enough real credentials or
 * endpoint configuration for a turn to plausibly succeed. Unlike the mere
 * existence of a settings entry (which migrations and empty "connect" saves
 * can create), this requires provider-appropriate evidence: an API key or
 * OAuth token, cloud credentials (AWS/GCP/Azure/SAP), a local-auth CLI, or a
 * resolvable endpoint + model for keyless local providers.
 */
export function isProviderSettingsUsable(
	providerId: string,
	settings: ProviderSettings | undefined,
	config?: Pick<ProviderConfig, "baseUrl" | "modelId">,
): boolean {
	if (!settings) {
		return false;
	}
	const normalizedProviderId = LlmsModels.normalizeProviderId(providerId);
	if (
		LlmsModels.normalizeProviderId(settings.provider) !== normalizedProviderId
	) {
		return false;
	}
	if (normalizedProviderId === "bedrock") {
		return (
			(Boolean(getPersistedProviderApiKey(normalizedProviderId, settings)) ||
				hasAwsCredentials(settings)) &&
			hasAwsRegion(settings)
		);
	}
	if (normalizedProviderId === "sapaicore") {
		return hasSapCredentials(settings);
	}
	if (getPersistedProviderApiKey(normalizedProviderId, settings)) {
		return true;
	}
	if (isOAuthProvider(normalizedProviderId)) {
		return false;
	}
	const fields = getProviderConfigFields(normalizedProviderId);
	if (fields.authMethod === "local") {
		return true;
	}
	if (normalizedProviderId === "vertex") {
		return hasGcpCredentials(settings);
	}
	if (normalizedProviderId === "azure") {
		return hasAzureCredentials(settings);
	}
	if (!fields.fields.baseUrl) {
		return false;
	}
	return (
		hasText(config?.baseUrl ?? settings.baseUrl) &&
		hasText(config?.modelId ?? settings.model)
	);
}
