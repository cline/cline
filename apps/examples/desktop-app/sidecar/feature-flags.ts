import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type BasicLogger,
	FEATURE_FLAGS,
	type FeatureFlagPayload,
	type FeatureFlagsContext,
	FeatureFlagsService,
	type InternalFeature,
	type ITelemetryService,
	isInternalFeatureEnabled,
	NoOpFeatureFlagsProvider,
	resolveCoreDistinctId,
} from "@cline/core";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";
import { resolveClineDataDir } from "@cline/shared/storage";
import { readDesktopSettings } from "./desktop-settings";

const DESKTOP_FEATURE_FLAGS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DESKTOP_ACCOUNT_CONTEXT_FILE_VERSION = 1;

let desktopFeatureFlagsContext: FeatureFlagsContext = {
	clientName: "cline-code",
};
let desktopFeatureFlagsService: FeatureFlagsService | undefined;
let desktopAccountContextHydrated = false;

function resolveDesktopFeatureFlagsCachePath(): string {
	return join(resolveClineDataDir(), "cache", "feature-flags.cline-code.json");
}

/**
 * Where the last-known account identity ({@link setDesktopFeatureFlagsAccountContext})
 * is remembered between launches. The account email only reaches the sidecar
 * when the webview fetches the account; without this file, internal-feature
 * gates would open only after that fetch on every launch.
 */
function resolveDesktopAccountContextPath(): string {
	return join(
		resolveClineDataDir(),
		"cache",
		"feature-flags-account.cline-code.json",
	);
}

function hydrateDesktopAccountContextOnce(): void {
	if (desktopAccountContextHydrated) {
		return;
	}
	desktopAccountContextHydrated = true;
	try {
		const path = resolveDesktopAccountContextPath();
		if (!existsSync(path)) {
			return;
		}
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			version?: unknown;
			userId?: unknown;
			email?: unknown;
		};
		if (
			parsed?.version !== DESKTOP_ACCOUNT_CONTEXT_FILE_VERSION ||
			typeof parsed.userId !== "string" ||
			!parsed.userId
		) {
			return;
		}
		desktopFeatureFlagsContext = {
			...desktopFeatureFlagsContext,
			distinctId: parsed.userId,
			userId: parsed.userId,
			email:
				typeof parsed.email === "string" && parsed.email
					? parsed.email
					: undefined,
		};
	} catch {
		// A missing or corrupt file only delays gating until the account fetch.
	}
}

function persistDesktopAccountContext(logger?: BasicLogger): void {
	try {
		const path = resolveDesktopAccountContextPath();
		const { userId, email } = desktopFeatureFlagsContext;
		if (!userId) {
			rmSync(path, { force: true });
			return;
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			`${JSON.stringify(
				{
					version: DESKTOP_ACCOUNT_CONTEXT_FILE_VERSION,
					userId,
					email: email ?? undefined,
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
	} catch (error) {
		logger?.error?.("Error persisting desktop account context", { error });
	}
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
	hydrateDesktopAccountContextOnce();
	ensureDesktopDistinctId();
	return { ...desktopFeatureFlagsContext };
}

/**
 * Whether this install may use an internal-only feature: the signed-in
 * account has an internal (`@cline.bot`) email — learned from the account
 * fetch and remembered across launches — or the feature's own flag was
 * enabled for the account (the PostHog escape hatch). Signed-out and
 * never-fetched accounts fail closed.
 */
export function isDesktopInternalFeatureEnabled(
	feature: InternalFeature,
	options?: { logger?: BasicLogger; telemetry?: ITelemetryService },
): boolean {
	hydrateDesktopAccountContextOnce();
	return isInternalFeatureEnabled(feature, {
		email: desktopFeatureFlagsContext.email,
		isFlagEnabled: (flagKey) =>
			getDesktopFeatureFlagsService(options).getBooleanFlagEnabled(flagKey),
	});
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

export function setDesktopFeatureFlagsAccountContext(
	account: {
		id?: string;
		email?: string;
	},
	options?: { logger?: BasicLogger },
): boolean {
	hydrateDesktopAccountContextOnce();
	const accountId = account.id?.trim() || undefined;
	const previousUserId = desktopFeatureFlagsContext.userId ?? undefined;
	const previousEmail = desktopFeatureFlagsContext.email ?? undefined;
	// Callers that only know the account ID (e.g. provider-settings syncs)
	// must not erase an email a full account fetch already provided — the
	// email is what internal-feature gating keys on. A different account (or
	// sign-out) always drops it.
	const email =
		account.email?.trim() ||
		(accountId && accountId === previousUserId ? previousEmail : undefined);
	if (previousUserId === accountId && previousEmail === email) {
		return false;
	}

	if (accountId) {
		desktopFeatureFlagsContext = {
			...desktopFeatureFlagsContext,
			distinctId: accountId,
			userId: accountId,
			email,
		};
	} else {
		// Drop the identifiers; ensureDesktopDistinctId re-resolves the device
		// ID on the next read rather than leaving the old account's ID behind.
		const {
			distinctId: _distinctId,
			userId: _userId,
			email: _email,
			...rest
		} = desktopFeatureFlagsContext;
		desktopFeatureFlagsContext = rest;
	}

	persistDesktopAccountContext(options?.logger);
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
		!setDesktopFeatureFlagsAccountContext(account, options) ||
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

export function readCloudAgentsEnvOverride(): boolean | undefined {
	const override = process.env.CLINE_CODE_CLOUD_AGENTS?.trim().toLowerCase();
	if (override === "1" || override === "true") return true;
	if (override === "0" || override === "false") return false;
	return undefined;
}

/** The beta always exposes the existing Cloud sessions opt-in. */
export function isCloudAgentsAvailable(_options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): boolean {
	const override = readCloudAgentsEnvOverride();
	if (override !== undefined) return override;
	return true;
}

/** The existing Settings toggle remains the beta opt-in. */
export function isCloudAgentsEnabled(_options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): boolean {
	const override = readCloudAgentsEnvOverride();
	if (override !== undefined) return override;
	return readDesktopSettings().cloudSessionsEnabled;
}

export function readCloudHandoffEnvOverride(): boolean | undefined {
	const override = process.env.CLINE_CODE_CLOUD_HANDOFF?.trim().toLowerCase();
	if (override === "1" || override === "true") return true;
	if (override === "0" || override === "false") return false;
	return undefined;
}

/** Handoff ships with the beta and remains gated by Cloud sessions in the UI. */
export function isCloudHandoffEnabled(_options?: {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}): boolean {
	return readCloudHandoffEnvOverride() ?? true;
}

export function resetDesktopFeatureFlagsForTesting(): void {
	desktopFeatureFlagsService = undefined;
	desktopFeatureFlagsContext = { clientName: "cline-code" };
	desktopAccountContextHydrated = false;
}
