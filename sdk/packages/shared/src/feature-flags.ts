export type FeatureFlag = string;

export type FeatureFlagJsonValue =
	| string
	| number
	| boolean
	| null
	| { [key: string]: FeatureFlagJsonValue }
	| FeatureFlagJsonValue[];

export type FeatureFlagPayload = FeatureFlagJsonValue;

export type FeatureFlagsAndPayloads = {
	featureFlags?: Record<string, FeatureFlagPayload>;
	featureFlagPayloads?: Record<string, FeatureFlagPayload>;
};

export interface FeatureFlagsContext {
	/** Stable SDK/client/user identifier used by providers that evaluate per identity. */
	distinctId?: string;
	/** Authenticated Cline account/user ID, when available. */
	userId?: string | null;
	/** Optional SDK consumer name, e.g. `my-production-app`. */
	clientName?: string;
}

export interface FeatureFlagsSettings {
	/** Whether the provider is enabled. */
	enabled: boolean;
	/** Optional timeout for feature flag requests. */
	timeout?: number;
}

export interface IFeatureFlagsProvider {
	getAllFlagsAndPayloads(options: {
		flagKeys?: readonly string[];
		context?: FeatureFlagsContext;
	}): Promise<FeatureFlagsAndPayloads | undefined>;
	isEnabled(): boolean;
	getSettings(): FeatureFlagsSettings;
	dispose(): Promise<void>;
}

export const FeatureFlagDefaultValue: Partial<
	Record<FeatureFlag, FeatureFlagPayload | undefined>
> = {};

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.keys(
	FeatureFlagDefaultValue,
);
