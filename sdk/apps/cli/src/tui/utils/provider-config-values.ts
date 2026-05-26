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
