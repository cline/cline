import { InternalFeature } from "./internal-features";

export const FeatureFlag = {
	/** Enables ClinePass provider/model list exposure in supported clients. */
	CLINE_PASS: "ext-cline-pass",
	/** Makes the Cloud sessions opt-in visible in the Cline Code desktop app. */
	CODE_CLOUD_AGENTS: "code-cloud-agents",
	/** Enables /handoff (local-to-cloud session handoff) in the Cline Code desktop app. */
	CODE_CLOUD_HANDOFF: "code-cloud-handoff",
	/** Shows the GitHub integration step in the desktop app. */
	CODE_ONBOARDING_GITHUB: "code-onboarding-github",
	/** Widens access to the internal-only Composio connectors beyond
	 * `@cline.bot` accounts (see `internal-features.ts`). */
	INTERNAL_COMPOSIO_CONNECTORS: InternalFeature.COMPOSIO_CONNECTORS,
} as const;

export type KnownFeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];
export type FeatureFlag = KnownFeatureFlag | (string & {});

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
	/**
	 * Authenticated account email, when available. Used locally for
	 * internal-feature gating (see `internal-features.ts`); providers do not
	 * send it anywhere.
	 */
	email?: string | null;
	/** Optional SDK consumer name, e.g. `my-production-app`. */
	clientName?: string;
}

type AssertTrue<T extends true> = T;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type HasNonPrimitiveFieldNames<T> = {
	[K in keyof T]-?: Exclude<T[K], Primitive> extends never ? never : K;
}[keyof T];
type HasOnlyPrimitiveFields<T> =
	HasNonPrimitiveFieldNames<T> extends never ? true : false;
export type FeatureFlagsContextPrimitiveValued = AssertTrue<
	HasOnlyPrimitiveFields<FeatureFlagsContext>
>;

export interface FeatureFlagsSettings {
	/** Whether the provider is enabled. */
	enabled: boolean;
	/** Optional timeout in ms for feature flag requests. */
	timeoutMs?: number;
}

export interface IFeatureFlagsProvider {
	getAllFlagsAndPayloads(options: {
		flagKeys?: readonly string[];
		context: FeatureFlagsContext;
	}): Promise<FeatureFlagsAndPayloads | undefined>;
	readonly enabled: boolean;
	getSettings(): FeatureFlagsSettings;
	dispose(): Promise<void>;
}

export const FeatureFlagDefaultValue: Partial<
	Record<FeatureFlag, FeatureFlagPayload | undefined>
> = {
	[FeatureFlag.CLINE_PASS]: false,
	[FeatureFlag.CODE_CLOUD_AGENTS]: false,
	[FeatureFlag.CODE_ONBOARDING_GITHUB]: false,
	[FeatureFlag.INTERNAL_COMPOSIO_CONNECTORS]: false,
};

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.values(FeatureFlag);
