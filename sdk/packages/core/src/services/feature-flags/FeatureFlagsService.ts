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
} from "@cline/shared";
import { CORE_TELEMETRY_EVENTS } from "../..";

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
	telemetry?: ITelemetryService;
	logger?: BasicLogger;
	cacheTtlMs?: number;
	cacheFilePath?: string;
	persistentCacheMaxAgeMs?: number;
	context?: FeatureFlagsContext;
}

export class FeatureFlagsService {
	private readonly provider: IFeatureFlagsProvider;
	private readonly telemetry?: ITelemetryService;
	private readonly logger?: BasicLogger;
	private readonly cacheTtlMs: number;
	private readonly cacheFilePath?: string;
	private readonly persistentCacheMaxAgeMs: number;
	private context: FeatureFlagsContext;
	private cache: Map<FeatureFlag, FeatureFlagPayload | undefined> = new Map();
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null };

	constructor(options: FeatureFlagsServiceOptions) {
		this.provider = options.provider;
		this.telemetry = options.telemetry;
		this.logger = options.logger;
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.cacheFilePath = options.cacheFilePath;
		this.persistentCacheMaxAgeMs =
			options.persistentCacheMaxAgeMs ?? DEFAULT_PERSISTENT_CACHE_MAX_AGE_MS;
		this.context = { ...(options.context ?? {}) };
		this.hydrateFromPersistentCache(this.context.userId ?? null);
	}

	setContext(context: FeatureFlagsContext): void {
		const previousUserId = this.context.userId ?? null;
		this.context = { ...context };
		const nextUserId = this.context.userId ?? null;
		if (nextUserId !== previousUserId) {
			const snapshot = this.readPersistentCache(nextUserId);
			this.hydrateCache(snapshot ?? { updateTime: 0, userId: nextUserId });
		}
	}

	hydrateCache(snapshot: FeatureFlagsCacheSnapshot): void {
		this.cacheInfo = {
			updateTime: snapshot.updateTime,
			userId: snapshot.userId,
			flagsPayload: snapshot.flagsPayload,
		};
		this.rebuildCacheFromSnapshot(snapshot.flagsPayload);
	}

	getCacheSnapshot(): FeatureFlagsCacheSnapshot {
		return {
			updateTime: this.cacheInfo.updateTime,
			userId: this.cacheInfo.userId,
			flagsPayload: this.cacheInfo.flagsPayload,
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
				flagKeys: FEATURE_FLAGS.length > 0 ? FEATURE_FLAGS : undefined,
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

	private hydrateFromPersistentCache(userId: string | null): void {
		const snapshot = this.readPersistentCache(userId);
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

	private readPersistentCache(
		userId: string | null,
	): FeatureFlagsCacheSnapshot | undefined {
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
				userId: cache.userId || userId,
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
				...Object.keys(values?.featureFlags ?? {}),
				...Object.keys(values?.featureFlagPayloads ?? {}),
			]),
		];
	}

	private rebuildCacheFromSnapshot(
		values: FeatureFlagsAndPayloads | undefined,
	): void {
		const nextCache = new Map<FeatureFlag, FeatureFlagPayload | undefined>();
		for (const flag of this.getReturnedFlagKeys(values)) {
			const payload = this.getFeatureFlag(flag);
			nextCache.set(flag, payload ?? false);
		}
		this.cache = nextCache;
	}

	private getFeatureFlag(
		flagName: FeatureFlag,
	): FeatureFlagPayload | undefined {
		try {
			const payload =
				this.cacheInfo.flagsPayload?.featureFlagPayloads?.[flagName];
			const flagValue = this.cacheInfo.flagsPayload?.featureFlags?.[flagName];
			const value =
				payload ?? flagValue ?? FeatureFlagDefaultValue[flagName] ?? undefined;

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
			return FeatureFlagDefaultValue[flagName] ?? false;
		}
	}

	getBooleanFlagEnabled(flagName: FeatureFlag): boolean {
		return this.cache.get(flagName) === true;
	}

	getFlagPayload(flagName: FeatureFlag): FeatureFlagPayload | undefined {
		return this.cache.get(flagName) ?? FeatureFlagDefaultValue[flagName];
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

	test(flagName: FeatureFlag, value: boolean): void {
		if (process.env.NODE_ENV === "test" || process.env.IS_TEST === "true") {
			this.cache.set(flagName, value);
		}
	}

	async dispose(): Promise<void> {
		await this.provider.dispose();
	}
}
