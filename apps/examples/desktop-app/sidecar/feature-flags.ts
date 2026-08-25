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
import { FeatureFlag as SharedFeatureFlag } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { readDesktopSettings } from "./desktop-settings";

const FEATURE_FLAG_CODE_CLOUD_AGENTS = SharedFeatureFlag.CODE_CLOUD_AGENTS;

const DESKTOP_FEATURE_FLAGS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let desktopFeatureFlagsContext: FeatureFlagsContext = {
	clientName: "cline-code",
};
let desktopFeatureFlagsService: FeatureFlagsService | undefined;

function resolveDesktopFeatureFlagsCachePath(): string {
	return join(resolveClineDataDir(), "cache", "feature-flags.cline-code.json");
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
}): boolean {
	const accountId = account.id?.trim();
	const previousUserId = desktopFeatureFlagsContext.userId ?? undefined;
	if (previousUserId === (accountId || undefined)) {
		return false;
	}

	if (accountId) {
		desktopFeatureFlagsContext = {
			...desktopFeatureFlagsContext,
			distinctId: accountId,
			userId: accountId,
		};
	} else {
		// Drop both identifiers; ensureDesktopDistinctId re-resolves the device
		// ID on the next read rather than leaving the old account's ID behind.
		const {
			distinctId: _distinctId,
			userId: _userId,
			...rest
		} = desktopFeatureFlagsContext;
		desktopFeatureFlagsContext = rest;
	}

	desktopFeatureFlagsService?.setContext(getDesktopFeatureFlagsContext());
	return true;
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

export async function identifyDesktopFeatureFlagsAccount(
	account: { id?: string; email?: string },
	options?: { logger?: BasicLogger; telemetry?: ITelemetryService },
): Promise<void> {
	if (
		!setDesktopFeatureFlagsAccountContext(account) ||
		!desktopFeatureFlagsService
	) {
		return;
	}

	try {
		await desktopFeatureFlagsService.poll();
	} catch (error) {
		options?.logger?.error?.("Error polling desktop feature flags", { error });
	}
}

export function resetDesktopFeatureFlagsForTesting(): void {
	desktopFeatureFlagsService = undefined;
	desktopFeatureFlagsContext = { clientName: "cline-code" };
}

/**
 * Dev/build override for the cloud gate: "1"/"true" forces it on,
 * "0"/"false" forces it off, anything else defers to the flag + setting.
 */
export function readCloudAgentsEnvOverride(): boolean | undefined {
	const override = process.env.CLINE_CODE_CLOUD_AGENTS?.trim().toLowerCase();
	if (override === "1" || override === "true") return true;
	if (override === "0" || override === "false") return false;
	return undefined;
}

/**
 * Whether the Cloud sessions surface is AVAILABLE to this install: the
 * PostHog rollout flag (cached snapshot; no network on this path) decides
 * who can see the Settings opt-in at all.
 */
export function isCloudAgentsAvailable(options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): boolean {
	const override = readCloudAgentsEnvOverride();
	if (override !== undefined) return override;
	return getDesktopFeatureFlagsService(options).getBooleanFlagEnabled(
		FEATURE_FLAG_CODE_CLOUD_AGENTS,
	);
}

/**
 * Whether cloud sessions are ENABLED for this user: rollout flag gates
 * availability, the user's Settings toggle is the opt-in.
 */
export function isCloudAgentsEnabled(options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): boolean {
	const override = readCloudAgentsEnvOverride();
	if (override !== undefined) return override;
	if (!isCloudAgentsAvailable(options)) return false;
	return readDesktopSettings().cloudSessionsEnabled;
}
