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

type CacheInfo = {
	updateTime: number;
	userId: string | null;
	flagsPayload?: FeatureFlagsAndPayloads;
};

export interface FeatureFlagsServiceOptions {
	provider: IFeatureFlagsProvider;
	telemetry?: ITelemetryService;
	logger?: BasicLogger;
	cacheTtlMs?: number;
	context?: FeatureFlagsContext;
}

export class FeatureFlagsService {
	private readonly provider: IFeatureFlagsProvider;
	private readonly telemetry?: ITelemetryService;
	private readonly logger?: BasicLogger;
	private readonly cacheTtlMs: number;
	private context: FeatureFlagsContext;
	private cache: Map<FeatureFlag, FeatureFlagPayload | undefined> = new Map();
	private cacheInfo: CacheInfo = { updateTime: 0, userId: null };

	constructor(options: FeatureFlagsServiceOptions) {
		this.provider = options.provider;
		this.telemetry = options.telemetry;
		this.logger = options.logger;
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.context = { ...(options.context ?? {}) };
	}

	setContext(context: FeatureFlagsContext): void {
		this.context = { ...context };
	}

	async poll(
		userId: string | null = this.context.userId ?? null,
	): Promise<void> {
		const timeNow = Date.now();
		if (timeNow - this.cacheInfo.updateTime < this.cacheTtlMs) {
			if (this.cacheInfo.userId === userId) {
				return;
			}
		}

		const previousCacheInfo = this.cacheInfo;
		this.cacheInfo = { updateTime: timeNow, userId: userId || null };

		try {
			const values = await this.provider.getAllFlagsAndPayloads({
				flagKeys: FEATURE_FLAGS.length > 0 ? FEATURE_FLAGS : undefined,
				context: { ...this.context, userId },
			});

			if (this.cacheInfo.userId !== userId) {
				// A new poll has started with a different userId, so we should not update the cache with the results of this poll
				return;
			}

			this.cacheInfo.flagsPayload = values;

			for (const flag of this.getReturnedFlagKeys(values)) {
				const payload = this.getFeatureFlag(flag);
				this.cache.set(flag, payload ?? false);
			}
		} catch (error) {
			if (this.cacheInfo.userId !== userId) {
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
