import {
	getProviderConfigFields,
	type ProviderConfig,
	type ProviderSettings,
} from "@cline/core";
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
