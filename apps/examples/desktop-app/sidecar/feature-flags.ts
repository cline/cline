import { join } from "node:path";
import {
	type BasicLogger,
	type FeatureFlagsContext,
	FeatureFlagsService,
	type ITelemetryService,
	NoOpFeatureFlagsProvider,
	ProviderSettingsManager,
	resolveCoreDistinctId,
} from "@cline/core";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";
import { FeatureFlag } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";

// Separate from the CLI cache to avoid cross-process writes.
const CACHE_FILE = "code-feature-flags.json";
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let desktopFeatureFlagsService: FeatureFlagsService | undefined;

export function buildDesktopFeatureFlagsContext(
	accountId?: string,
): FeatureFlagsContext {
	const normalizedAccountId = accountId?.trim();
	return {
		clientName: "cline-code",
		distinctId: normalizedAccountId || resolveCoreDistinctId(),
		userId: normalizedAccountId || null,
	};
}

function buildContext(): FeatureFlagsContext {
	const accountId = new ProviderSettingsManager().getProviderSettings("cline")
		?.auth?.accountId;
	return buildDesktopFeatureFlagsContext(accountId);
}

/** Clears cached targeting when the signed-in account changes. */
export function applyDesktopFeatureFlagsContext(
	service: FeatureFlagsService,
	context: FeatureFlagsContext,
): void {
	service.setContext(context);
	const userId = context.userId?.trim() || null;
	if (service.getCacheSnapshot().userId !== userId) {
		service.hydrateCache({ updateTime: 0, userId });
	}
}

export function getDesktopFeatureFlagsService(options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): FeatureFlagsService {
	if (!desktopFeatureFlagsService) {
		const apiKey = process.env.TELEMETRY_SERVICE_API_KEY;
		const provider =
			apiKey &&
			process.env.IS_TEST !== "true" &&
			process.env.E2E_TEST !== "true"
				? new PostHogFeatureFlagsProvider({
						client: buildClinePostHogClient(apiKey),
						config: { logger: options?.logger },
					})
				: new NoOpFeatureFlagsProvider();
		desktopFeatureFlagsService = new FeatureFlagsService({
			provider,
			telemetry: options?.telemetry,
			logger: options?.logger,
			context: buildContext(),
			cacheFilePath: join(resolveClineDataDir(), "cache", CACHE_FILE),
			persistentCacheMaxAgeMs: CACHE_MAX_AGE_MS,
		});
	}
	return desktopFeatureFlagsService;
}

/** Refreshes the current account's flags, falling back to cache/defaults. */
export async function refreshDesktopFeatureFlags(
	logger?: BasicLogger,
): Promise<void> {
	const service = getDesktopFeatureFlagsService({ logger });
	applyDesktopFeatureFlagsContext(service, buildContext());
	try {
		await service.poll();
	} catch (error) {
		logger?.log("Feature flag refresh failed", { error });
	}
}

/** Env override first; otherwise the cached provider evaluation (default off). */
export function isCloudAgentsEnabled(): boolean {
	const override = process.env.CLINE_CODE_CLOUD_AGENTS?.trim().toLowerCase();
	if (override === "1" || override === "true") {
		return true;
	}
	if (override === "0" || override === "false") {
		return false;
	}
	return getDesktopFeatureFlagsService().getBooleanFlagEnabled(
		FeatureFlag.CODE_CLOUD_AGENTS,
	);
}

export async function disposeDesktopFeatureFlagsService(): Promise<void> {
	const service = desktopFeatureFlagsService;
	desktopFeatureFlagsService = undefined;
	await service?.dispose();
}
