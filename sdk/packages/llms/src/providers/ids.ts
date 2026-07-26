export enum BUILT_IN_PROVIDER {
	BEDROCK = "bedrock",
}

export type BuiltInProviderId = "bedrock";
export const BUILT_IN_PROVIDER_IDS = ["bedrock"] as const;

export function isBuiltInProviderId(id: string): id is BuiltInProviderId {
	return id.trim() === "bedrock";
}

export function normalizeProviderId(_providerId: string): BuiltInProviderId {
	return "bedrock";
}
