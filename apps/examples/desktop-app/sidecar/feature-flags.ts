import { join } from "node:path";
import {
	type BasicLogger,
	FEATURE_FLAGS,
	type FeatureFlagPayload,
	type FeatureFlagsContext,
	FeatureFlagsService,
	type ITelemetryService,
	NoOpFeatureFlagsProvider,
	resolveCoreDistinctId,
} from "@cline/core";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";
import { resolveClineDataDir } from "@cline/shared/storage";

const DESKTOP_FEATURE_FLAGS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let desktopFeatureFlagsContext: FeatureFlagsContext = {
	clientName: "cline-code",
};
let desktopFeatureFlagsService: FeatureFlagsService | undefined;

function resolveDesktopFeatureFlagsCachePath(): string {
	return join(resolveClineDataDir(), "cache", "feature-flags.json");
}

function ensureDesktopDistinctId(): string {
	const distinctId = desktopFeatureFlagsContext.distinctId?.trim();
	if (distinctId) {
		return distinctId;
	}
	const resolved = resolveCoreDistinctId();
	desktopFeatureFlagsContext.distinctId = resolved;
	return resolved;
}

export function getDesktopFeatureFlagsContext(): FeatureFlagsContext {
	ensureDesktopDistinctId();
	return { ...desktopFeatureFlagsContext };
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
						config: {
							logger: options?.logger,
						},
					})
				: new NoOpFeatureFlagsProvider();

		desktopFeatureFlagsService = new FeatureFlagsService({
			provider,
			telemetry: options?.telemetry,
			logger: options?.logger,
			context: getDesktopFeatureFlagsContext(),
			cacheFilePath: resolveDesktopFeatureFlagsCachePath(),
			persistentCacheMaxAgeMs: DESKTOP_FEATURE_FLAGS_CACHE_MAX_AGE_MS,
		});
	}

	return desktopFeatureFlagsService;
}

export async function disposeDesktopFeatureFlagsService(): Promise<void> {
	if (!desktopFeatureFlagsService) {
		return;
	}

	const current = desktopFeatureFlagsService;
	desktopFeatureFlagsService = undefined;
	await current.dispose();
}

export function setDesktopFeatureFlagsAccountContext(account: {
	id?: string;
	email?: string;
}): void {
	const accountId = account.id?.trim();
	desktopFeatureFlagsContext = {
		...desktopFeatureFlagsContext,
		...(accountId ? { distinctId: accountId, userId: accountId } : {}),
		...(account.email?.trim() ? { email: account.email.trim() } : {}),
	};
	desktopFeatureFlagsService?.setContext(getDesktopFeatureFlagsContext());
}

export type FeatureFlagsSnapshot = {
	flags: Record<string, FeatureFlagPayload>;
};

export function buildFeatureFlagsSnapshot(
	service: FeatureFlagsService,
): FeatureFlagsSnapshot {
	const flags: Record<string, FeatureFlagPayload> = {};
	for (const flag of FEATURE_FLAGS) {
		flags[flag] = service.getFlagPayload(flag) ?? false;
	}
	return { flags };
}

/**
 * Refresh flags from PostHog, then hand back the resolved snapshot.
 *
 * Polling is cheap to call repeatedly.
 */
export async function refreshDesktopFeatureFlags(options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): Promise<FeatureFlagsSnapshot> {
	const service = getDesktopFeatureFlagsService(options);
	try {
		await service.poll();
	} catch (error) {
		options?.logger?.error?.("Error refreshing desktop feature flags", {
			error,
		});
	}
	return buildFeatureFlagsSnapshot(service);
}

export function resetDesktopFeatureFlagsForTesting(): void {
	desktopFeatureFlagsService = undefined;
	desktopFeatureFlagsContext = { clientName: "cline-code" };
}
