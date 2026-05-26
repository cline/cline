import type { ProviderConfigFieldKey } from "@cline/core";
import { resolveAwsRegion } from "../../utils/aws-region";

export type ProviderConfigValues = Partial<
	Record<ProviderConfigFieldKey, string>
>;

const DEFAULT_AWS_REGION = "us-east-1";

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

export function resolveProviderConfigSap(values: ProviderConfigValues):
	| {
			clientId?: string;
			clientSecret?: string;
			tokenUrl?: string;
			resourceGroup?: string;
			deploymentId?: string;
			useOrchestrationMode?: boolean;
	  }
	| undefined {
	const sap = {
		clientId: values.sapClientId?.trim() || undefined,
		clientSecret: values.sapClientSecret?.trim() || undefined,
		tokenUrl: values.sapTokenUrl?.trim() || undefined,
		resourceGroup: values.sapResourceGroup?.trim() || undefined,
		deploymentId: values.sapDeploymentId?.trim() || undefined,
		useOrchestrationMode: true,
	};
	return Object.values(sap).some((value) => value !== undefined)
		? sap
		: undefined;
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
