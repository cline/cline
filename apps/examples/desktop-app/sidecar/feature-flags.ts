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

// Own cache file (not the CLI's feature-flags.json) so the two processes
// never clobber each other's snapshots.
const CACHE_FILE = "code-feature-flags.json";
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let desktopFeatureFlagsService: FeatureFlagsService | undefined;

function buildContext(): FeatureFlagsContext {
	const accountId = new ProviderSettingsManager().getProviderSettings("cline")
		?.auth?.accountId;
	return {
		clientName: "cline-code",
		distinctId: resolveCoreDistinctId(),
		userId: accountId ?? null,
	};
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

/**
 * Refresh flags from the provider, re-reading the signed-in account first so
 * per-user targeting follows sign-in/sign-out. Errors are logged, never thrown
 * — flag reads fall back to the cached snapshot or registry defaults.
 */
export async function refreshDesktopFeatureFlags(
	logger?: BasicLogger,
): Promise<void> {
	const service = getDesktopFeatureFlagsService({ logger });
	service.setContext(buildContext());
	try {
		await service.poll();
	} catch (error) {
		logger?.log("Feature flag refresh failed", { error });
	}
}

/**
 * Whether cloud agent sessions are enabled. `CLINE_CODE_CLOUD_AGENTS` (1/0,
 * true/false) overrides the flag for local development and e2e rigs; otherwise
 * this reads the cached PostHog evaluation (registry default: off).
 */
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
