import type { ProviderConfigFieldKey } from "@cline/core";
import { resolveAwsRegion } from "../../utils/aws-region";

export type ProviderConfigValues = Partial<
	Record<ProviderConfigFieldKey, string>
>;

const DEFAULT_AWS_REGION = "us-east-1";
const DEFAULT_GCP_REGION = "us-central1";

export function getDefaultAwsRegion(profile?: string): string {
	return (
		resolveAwsRegion({ profile: profile?.trim() || undefined }) ??
		DEFAULT_AWS_REGION
	);
}

export function resolveProviderConfigAwsRegion(
	values: ProviderConfigValues,
): string {
	return values.awsRegion?.trim() || getDefaultAwsRegion(values.awsProfile);
}

export function resolveProviderConfigGcp(values: ProviderConfigValues):
	| {
			projectId?: string;
			region?: string;
	  }
	| undefined {
	const projectId = values.gcpProjectId?.trim() || undefined;
	if (!projectId) return undefined;
	return {
		projectId,
		region: values.gcpRegion?.trim() || DEFAULT_GCP_REGION,
	};
}

export function resolveProviderConfigSap(values: ProviderConfigValues):
	| {
			clientId?: string;
			clientSecret?: string;
			tokenUrl?: string;
			resourceGroup?: string;
			deploymentId?: string;
	  }
	| undefined {
	const sap = {
		clientId: values.sapClientId?.trim() || undefined,
		clientSecret: values.sapClientSecret?.trim() || undefined,
		tokenUrl: values.sapTokenUrl?.trim() || undefined,
		resourceGroup: values.sapResourceGroup?.trim() || undefined,
		deploymentId: values.sapDeploymentId?.trim() || undefined,
	};
	return Object.values(sap).some((value) => value !== undefined)
		? sap
		: undefined;
}

export function resolveProviderConfigAzure(values: ProviderConfigValues): {
	apiVersion?: string;
} {
	return { apiVersion: values.azureApiVersion?.trim() ?? "" };
}

/** Serialize stored headers into the single-line "key=value, key2=value2" form. */
export function formatProviderConfigHeaders(
	headers: Record<string, string> | undefined,
): string {
	if (!headers) {
		return "";
	}
	return Object.entries(headers)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

/**
 * Parse the single-line headers field. Entries are comma separated; each
 * entry splits at its first "=" so values may themselves contain "=".
 * Entries without a key are dropped (the form is deliberately forgiving;
 * provider errors are the authoritative feedback).
 */
export function parseProviderConfigHeaders(
	value: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!value) {
		return headers;
	}
	for (const entry of value.split(",")) {
		const separatorIndex = entry.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = entry.slice(0, separatorIndex).trim();
		if (!key) {
			continue;
		}
		headers[key] = entry.slice(separatorIndex + 1).trim();
	}
	return headers;
}

/**
 * Build the headers patch for `saveLocalProviderSettings` so the text field
 * is authoritative: parsed entries are upserted and existing keys missing
 * from the field are emptied, which the merge layer treats as deletion.
 */
export function resolveProviderConfigHeadersPatch(
	value: string | undefined,
	existingHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
	const parsed = parseProviderConfigHeaders(value);
	const patch: Record<string, string> = {};
	for (const key of Object.keys(existingHeaders ?? {})) {
		if (!(key in parsed)) {
			patch[key] = "";
		}
	}
	Object.assign(patch, parsed);
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/** Parse an optional numeric field; blank or invalid input clears the setting. */
export function resolveProviderConfigPositiveInteger(
	value: string | undefined,
): number | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function updateProviderConfigValue(
	previous: ProviderConfigValues,
	field: ProviderConfigFieldKey,
	value: string,
): ProviderConfigValues {
	const next: ProviderConfigValues = { ...previous, [field]: value };
	if (field !== "awsProfile") {
		return next;
	}

	const previousRegion = previous.awsRegion?.trim();
	const previousProfileRegion = getDefaultAwsRegion(previous.awsProfile);
	if (!previousRegion || previousRegion === previousProfileRegion) {
		next.awsRegion = getDefaultAwsRegion(value);
	}

	return next;
}
