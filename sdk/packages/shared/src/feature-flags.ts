export const FeatureFlag = {
	/** Enables ClinePass provider/model list exposure in supported clients. */
	CLINE_PASS: "ext-cline-pass",
	/**
	 * Enables Langfuse tracing for Cline-owned inference providers.
	 *
	 * The flag payload must be a valid {@link LangfuseTelemetryConfig}. Because
	 * it contains a secret key, consumers must keep it in memory only.
	 */
	LANGFUSE_TELEMETRY: "langfuse-telemetry",
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

/** Credentials supplied by the Langfuse feature-flag payload. */
export interface LangfuseTelemetryConfig {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
}

/**
 * Validate and normalize the Langfuse feature-flag payload.
 *
 * Returning `undefined` keeps malformed or partially configured flag
 * assignments fail-closed.
 */
export function parseLangfuseTelemetryConfig(
	payload: unknown,
): LangfuseTelemetryConfig | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;

	const baseUrl =
		typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
	const publicKey =
		typeof record.publicKey === "string" ? record.publicKey.trim() : "";
	const secretKey =
		typeof record.secretKey === "string" ? record.secretKey.trim() : "";
	if (!baseUrl || !publicKey || !secretKey) {
		return undefined;
	}

	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return undefined;
		}
	} catch {
		return undefined;
	}

	return { baseUrl, publicKey, secretKey };
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
};

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.values(FeatureFlag);

/** Feature flags whose payloads must never be persisted or exposed to UI clients. */
export const SENSITIVE_FEATURE_FLAGS: readonly FeatureFlag[] = [
	FeatureFlag.LANGFUSE_TELEMETRY,
];

export function isSensitiveFeatureFlag(flag: FeatureFlag): boolean {
	return SENSITIVE_FEATURE_FLAGS.includes(flag);
}
