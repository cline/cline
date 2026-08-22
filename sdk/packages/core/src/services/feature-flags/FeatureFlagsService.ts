import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	BasicLogger,
	FeatureFlagPayload,
	FeatureFlagsAndPayloads,
	FeatureFlagsContext,
	IFeatureFlagsProvider,
	ITelemetryService,
} from "@cline/shared";
import {
	FEATURE_FLAGS,
	type FeatureFlag,
	FeatureFlagDefaultValue,
	isSensitiveFeatureFlag,
} from "@cline/shared";
import { CORE_TELEMETRY_EVENTS } from "../telemetry/core-events";

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_PERSISTENT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURE_FLAGS_CACHE_FILE_VERSION = 1;

type CacheInfo = {
	updateTime: number;
	userId: string | null;
	flagsPayload?: FeatureFlagsAndPayloads;
};

export type FeatureFlagsCacheSnapshot = CacheInfo;

interface FeatureFlagsCacheFile {
	version: typeof FEATURE_FLAGS_CACHE_FILE_VERSION;
	updatedAt: number;
	userId: string | null;
	flagsPayload?: FeatureFlagsAndPayloads;
}

export interface FeatureFlagsServiceOptions {
	provider: IFeatureFlagsProvider;
	telemetry?: Pick<ITelemetryService, "capture">;
	logger?: BasicLogger;
	cacheTtlMs?: number;
	cacheFilePath?: string;
	persistentCacheMaxAgeMs?: number;
	context?: FeatureFlagsContext;
	/** Flag keys requested from the provider. Defaults to the shared SDK flags. */
	flagKeys?: readonly FeatureFlag[];
	/** Host-specific defaults merged over the shared SDK defaults. */
	defaultValues?: Partial<Record<FeatureFlag, FeatureFlagPayload | undefined>>;
}

export class FeatureFlagsService {
	private readonly provider: IFeatureFlagsProvider;
	private readonly telemetry?: Pick<ITelemetryService, "capture">;
	private readonly logger?: BasicLogger;
	private readonly cacheTtlMs: number;
	private readonly cacheFilePath?: string;
	private readonly persistentCacheMaxAgeMs: number;
	private readonly flagKeys: readonly FeatureFlag[];
	private readonly defaultValues: Partial<
		Record<FeatureFlag, FeatureFlagPayload | undefined>
	>;
	private context: FeatureFlagsContext;
	private cache: Map<FeatureFlag, FeatureFlagPayload | undefined> = new Map();
	private enabledCache = new Map<FeatureFlag, boolean>();
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null };

	constructor(options: FeatureFlagsServiceOptions) {
		this.provider = options.provider;
		this.telemetry = options.telemetry;
		this.logger = options.logger;
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.cacheFilePath = options.cacheFilePath;
		this.persistentCacheMaxAgeMs =
			options.persistentCacheMaxAgeMs ?? DEFAULT_PERSISTENT_CACHE_MAX_AGE_MS;
		this.flagKeys = options.flagKeys ?? FEATURE_FLAGS;
		this.defaultValues = {
			...FeatureFlagDefaultValue,
			...(options.defaultValues ?? {}),
		};
		this.context = { ...(options.context ?? {}) };
		this.hydrateFromPersistentCache();
	}

	setContext(context: FeatureFlagsContext): void {
		this.context = { ...context };
	}

	hydrateCache(snapshot: FeatureFlagsCacheSnapshot): void {
		const flagsPayload = this.withoutSensitiveFlags(snapshot.flagsPayload);
		const requiresVolatileRefresh = this.flagKeys.some((flag) =>
			isSensitiveFeatureFlag(flag),
		);
		this.cacheInfo = {
			// Sensitive payloads are intentionally absent from persistent storage,
			// so a hydrated cache cannot be considered fresh for this process.
			updateTime: requiresVolatileRefresh ? 0 : snapshot.updateTime,
			userId: snapshot.userId,
			flagsPayload,
		};
		this.rebuildCacheFromSnapshot(flagsPayload);
	}

	getCacheSnapshot(): FeatureFlagsCacheSnapshot {
		return {
			updateTime: this.cacheInfo.updateTime,
			userId: this.cacheInfo.userId,
			flagsPayload: this.withoutSensitiveFlags(this.cacheInfo.flagsPayload),
		};
	}

	async poll(userId?: string | null): Promise<void> {
		const resolvedUserId = userId ?? this.context.userId ?? null;
		const timeNow = Date.now();
		if (timeNow - this.cacheInfo.updateTime < this.cacheTtlMs) {
			if (this.cacheInfo.userId === resolvedUserId) {
				return;
			}
		}

		const previousCacheInfo = this.cacheInfo;
		this.cacheInfo = { updateTime: timeNow, userId: resolvedUserId || null };

		try {
			const values = await this.provider.getAllFlagsAndPayloads({
				flagKeys: this.flagKeys.length > 0 ? this.flagKeys : undefined,
				context: { ...this.context, userId: resolvedUserId },
			});

			if (this.cacheInfo.userId !== resolvedUserId) {
				// A new poll has started with a different userId, so we should not update the cache with the results of this poll
				return;
			}

			this.cacheInfo.flagsPayload = values;
			this.rebuildCacheFromSnapshot(values);
			this.writePersistentCache();
		} catch (error) {
			if (this.cacheInfo.userId !== resolvedUserId) {
				// A new poll has started with a different userId, so we should not update the cache with the results of this poll
				return;
			}

			this.cacheInfo = previousCacheInfo.updateTime
				? previousCacheInfo
				: { updateTime: 0, userId: null };
			this.logger?.error?.("Error polling SDK feature flags", { error });
			throw error;
		}
	}

	private hydrateFromPersistentCache(): void {
		const snapshot = this.readPersistentCache();
		if (snapshot) {
			this.hydrateCache(snapshot);
		}
	}

	private isFeatureFlagPayload(value: unknown): value is FeatureFlagPayload {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			return true;
		}
		if (Array.isArray(value)) {
			return value.every((entry) => this.isFeatureFlagPayload(entry));
		}
		if (typeof value === "object") {
			return Object.values(value as Record<string, unknown>).every((entry) =>
				this.isFeatureFlagPayload(entry),
			);
		}
		return false;
	}

	private readPayloadRecord(
		value: unknown,
	): Record<string, FeatureFlagPayload> | undefined {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return undefined;
		}

		const entries = Object.entries(value as Record<string, unknown>).filter(
			([, entryValue]) => this.isFeatureFlagPayload(entryValue),
		);
		if (entries.length === 0) {
			return undefined;
		}

		const record: Record<string, FeatureFlagPayload> = {};
		for (const [key, entryValue] of entries) {
			record[key] = entryValue as FeatureFlagPayload;
		}
		return record;
	}

	private withoutSensitiveFlags(
		values: FeatureFlagsAndPayloads | undefined,
	): FeatureFlagsAndPayloads | undefined {
		if (!values) {
			return undefined;
		}

		const filterRecord = (
			record: Record<string, FeatureFlagPayload> | undefined,
		): Record<string, FeatureFlagPayload> | undefined => {
			if (!record) {
				return undefined;
			}
			const entries = Object.entries(record).filter(
				([flag]) => !isSensitiveFeatureFlag(flag),
			);
			return entries.length > 0 ? Object.fromEntries(entries) : undefined;
		};

		return {
			featureFlags: filterRecord(values.featureFlags),
			featureFlagPayloads: filterRecord(values.featureFlagPayloads),
		};
	}

	private readPersistentCache(): FeatureFlagsCacheSnapshot | undefined {
		try {
			if (!this.cacheFilePath || !existsSync(this.cacheFilePath)) {
				return undefined;
			}

			const parsed = JSON.parse(
				readFileSync(this.cacheFilePath, "utf8"),
			) as unknown;
			if (!parsed || typeof parsed !== "object") {
				return undefined;
			}

			const cache = parsed as Partial<FeatureFlagsCacheFile> & {
				flagsPayload?: {
					featureFlags?: unknown;
					featureFlagPayloads?: unknown;
				};
			};

			// We don't validate the userId here because we want to allow falling back to an existing cache even
			// if the userId hasn't been resolved yet
			if (
				cache.version !== FEATURE_FLAGS_CACHE_FILE_VERSION ||
				typeof cache.updatedAt !== "number" ||
				!Number.isFinite(cache.updatedAt) ||
				Date.now() - cache.updatedAt > this.persistentCacheMaxAgeMs
			) {
				return undefined;
			}

			return {
				updateTime: cache.updatedAt,
				userId: cache.userId ?? null,
				flagsPayload: {
					featureFlags: this.readPayloadRecord(
						cache.flagsPayload?.featureFlags,
					),
					featureFlagPayloads: this.readPayloadRecord(
						cache.flagsPayload?.featureFlagPayloads,
					),
				},
			};
		} catch (error) {
			this.logger?.error?.("Error reading SDK feature flags cache", { error });
			return undefined;
		}
	}

	private writePersistentCache(): void {
		try {
			if (!this.cacheFilePath) {
				return;
			}

			mkdirSync(dirname(this.cacheFilePath), { recursive: true, mode: 0o700 });
			const snapshot = this.getCacheSnapshot();
			const cache: FeatureFlagsCacheFile = {
				version: FEATURE_FLAGS_CACHE_FILE_VERSION,
				updatedAt: snapshot.updateTime,
				userId: snapshot.userId,
				flagsPayload: snapshot.flagsPayload,
			};
			writeFileSync(
				this.cacheFilePath,
				`${JSON.stringify(cache, null, 2)}\n`,
				"utf8",
			);
		} catch (error) {
			this.logger?.error?.("Error writing SDK feature flags cache", { error });
		}
	}

	private getReturnedFlagKeys(
		values: FeatureFlagsAndPayloads | undefined,
	): FeatureFlag[] {
		return [
			...new Set([
				...this.flagKeys,
				...Object.keys(values?.featureFlags ?? {}),
				...Object.keys(values?.featureFlagPayloads ?? {}),
			]),
		];
	}

	private rebuildCacheFromSnapshot(
		values: FeatureFlagsAndPayloads | undefined,
	): void {
		const nextCache = new Map<FeatureFlag, FeatureFlagPayload | undefined>();
		const nextEnabledCache = new Map<FeatureFlag, boolean>();
		for (const flag of this.getReturnedFlagKeys(values)) {
			const payload = this.getFeatureFlag(flag);
			nextCache.set(flag, payload ?? false);
			const flagValue = values?.featureFlags?.[flag];
			nextEnabledCache.set(
				flag,
				flagValue === true ||
					typeof flagValue === "string" ||
					(flagValue === undefined && this.defaultValues[flag] === true),
			);
		}
		this.cache = nextCache;
		this.enabledCache = nextEnabledCache;
	}

	private getFeatureFlag(
		flagName: FeatureFlag,
	): FeatureFlagPayload | undefined {
		try {
			const payload =
				this.cacheInfo.flagsPayload?.featureFlagPayloads?.[flagName];
			const flagValue = this.cacheInfo.flagsPayload?.featureFlags?.[flagName];
			const value =
				payload ?? flagValue ?? this.defaultValues[flagName] ?? undefined;

			if (!this.cache.has(flagName) || this.cache.get(flagName) !== value) {
				this.telemetry?.capture({
					event: CORE_TELEMETRY_EVENTS.FEATURE_FLAGS.FLAG_CALLED,
					properties: {
						$feature_flag: flagName,
						$feature_flag_response: flagValue,
					},
				});
			}

			return value;
		} catch (error) {
			this.logger?.error?.(`Error checking SDK feature flag ${flagName}`, {
				error,
			});
			return this.defaultValues[flagName] ?? false;
		}
	}

	getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.enabledCache.get(flagName) === true;
	}

	getFlagPayload(flagName: FeatureFlag): FeatureFlagPayload | undefined {
		return this.cache.get(flagName) ?? this.defaultValues[flagName];
	}

	getProvider(): IFeatureFlagsProvider {
		return this.provider;
	}

	get enabled(): boolean {
		return this.provider.enabled;
	}

	getSettings() {
		return this.provider.getSettings();
	}

	test(flagName: FeatureFlag, value: FeatureFlagPayload): void {
		if (process.env.NODE_ENV === "test" || process.env.IS_TEST === "true") {
			this.cache.set(flagName, value);
			this.enabledCache.set(
				flagName,
				value === true ||
					typeof value === "string" ||
					(typeof value === "object" && value !== null),
			);
		}
	}

	async dispose(): Promise<void> {
		await this.provider.dispose();
	}
}
