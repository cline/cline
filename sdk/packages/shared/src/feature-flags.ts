export const FeatureFlag = {
	/** Enables ClinePass provider/model list exposure in supported clients. */
	CLINE_PASS: "ext-cline-pass",
	/**
	 * Enables Langfuse tracing for Cline-owned inference providers.
	 *
	 * The flag value must contain a `publicKey::secretKey` credential pair.
	 * Because it contains a secret key, consumers must keep it in memory only.
	 */
	LANGFUSE_TELEMETRY: "langfuse-telemetry",
	/** Shows the GitHub integration step in the desktop app */
	CODE_ONBOARDING_GITHUB: "code-onboarding-github",
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

/** Langfuse exporter credentials transported to an inference runtime. */
export interface LangfuseTelemetryConfig {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
}

export const DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL =
	"https://us.cloud.langfuse.com";

/**
 * Parse the sensitive Langfuse feature-flag value.
 *
 * PostHog returns the public and secret keys as one `publicKey::secretKey`
 * string. The Cline-owned exporter always targets the fixed US cloud endpoint.
 * Returning `undefined` keeps malformed assignments fail-closed.
 */
export function parseLangfuseTelemetryFeatureFlag(
	value: unknown,
): LangfuseTelemetryConfig | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const parts = value.split("::");
	if (parts.length !== 2) {
		return undefined;
	}
	const publicKey = parts[0]?.trim();
	const secretKey = parts[1]?.trim();
	if (!publicKey || !secretKey) {
		return undefined;
	}

	return {
		baseUrl: DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
		publicKey,
		secretKey,
	};
}

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
	[FeatureFlag.LANGFUSE_TELEMETRY]: false,
	[FeatureFlag.CODE_ONBOARDING_GITHUB]: false,
};

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.values(FeatureFlag);

/** Feature flags whose assignments or payloads must never leave process memory. */
export const SENSITIVE_FEATURE_FLAGS: readonly FeatureFlag[] = [
	FeatureFlag.LANGFUSE_TELEMETRY,
];

export function isSensitiveFeatureFlag(flag: FeatureFlag): boolean {
	return SENSITIVE_FEATURE_FLAGS.includes(flag);
}
