import {
	getProviderConfigFields,
	type ProviderConfig,
	type ProviderSettings,
} from "@clinebot/core";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "./provider-auth";

function hasText(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasAwsCredentials(settings: ProviderSettings): boolean {
	const aws = settings.aws;
	if (!aws) {
		return false;
	}
	if (aws.authentication === "iam") {
		return true;
	}
	if (hasText(aws.profile)) {
		return true;
	}
	return hasText(aws.accessKey) && hasText(aws.secretKey);
}

function hasGcpCredentials(settings: ProviderSettings): boolean {
	const gcp = settings.gcp;
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
		hasText(sap?.tokenUrl)
	);
}

export function isProviderSettingsUsable(
	providerId: string,
	settings: ProviderSettings | undefined,
	config?: Pick<ProviderConfig, "baseUrl" | "modelId">,
): boolean {
	if (!settings) {
		return false;
	}
	const normalizedProviderId = normalizeProviderId(providerId);
	if (normalizeProviderId(settings.provider) !== normalizedProviderId) {
		return false;
	}
	if (getPersistedProviderApiKey(normalizedProviderId, settings)) {
		return true;
	}
	if (isOAuthProvider(normalizedProviderId)) {
		return false;
	}
	if (normalizedProviderId === "bedrock") {
		return hasAwsCredentials(settings);
	}
	if (normalizedProviderId === "vertex") {
		return hasGcpCredentials(settings);
	}
	if (normalizedProviderId === "azure") {
		return hasAzureCredentials(settings);
	}
	if (normalizedProviderId === "sapaicore") {
		return hasSapCredentials(settings);
	}
	const fields = getProviderConfigFields(normalizedProviderId).fields;
	if (!fields.baseUrl) {
		return false;
	}
	return (
		hasText(config?.baseUrl ?? settings.baseUrl) &&
		hasText(config?.modelId ?? settings.model)
	);
}
