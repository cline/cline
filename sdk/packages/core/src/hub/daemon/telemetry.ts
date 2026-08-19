import { release } from "node:os";
import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
} from "@cline/shared";
import type { AuthSettings } from "../../services/llms/provider-settings";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { identifyAccount } from "../../services/telemetry/core-events";
import { createConfiguredTelemetryHandle } from "../../services/telemetry/OpenTelemetryProvider";
import { CORE_BUILD_VERSION } from "../../version";

const IDENTITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISPOSE_FLUSH_TIMEOUT_MS = 5_000;

export interface HubDaemonTelemetry {
	readonly telemetry: ITelemetryService;
	/** Flushes pending batches and disposes the underlying provider. */
	dispose(): Promise<void>;
}

/**
 * Telemetry for the detached hub daemon process.
 *
 * The daemon hosts the `LocalRuntimeHost` that emits `task.conversation_turn`
 * and `task.tokens` for every hub-backed session, so without its own handle
 * those events are dropped entirely - sessions bill on the backend while
 * reporting nothing to OTel.
 *
 * The daemon is long-lived and frequently starts before the user logs in (or
 * outlives an account switch), so the cached Cline account id is re-resolved
 * periodically rather than only once at startup.
 */
export function createHubDaemonTelemetry(): HubDaemonTelemetry {
	const config = createClineTelemetryServiceConfig({
		metadata: {
			extension_version: CORE_BUILD_VERSION,
			// "hub", not "cli": daemon-hosted sessions can be triggered by the
			// CLI, desktop app, or connectors, so daemon-emitted events must be
			// distinguishable from the CLI process's own events.
			cline_type: "hub",
			platform: "cline-hub-daemon",
			platform_version: process.version,
			os_type: process.platform,
			os_version: release(),
		},
	});
	const handle = createConfiguredTelemetryHandle(config);

	// Constructed once and reused: the constructor runs legacy settings
	// migration and provider registration side effects, while
	// getProviderSettings re-reads the file on every call anyway.
	let settingsManager: ProviderSettingsManager | undefined;
	const resolveCachedClineAuth = (): AuthSettings | undefined => {
		try {
			settingsManager ??= new ProviderSettingsManager();
			return settingsManager.getProviderSettings("cline")?.auth;
		} catch {
			// Telemetry identity must never interfere with daemon operation.
			return undefined;
		}
	};

	let identifiedKey: string | undefined;
	const refreshIdentity = (): void => {
		const auth = resolveCachedClineAuth();
		const accountId = auth?.accountId?.trim();
		if (!auth || !accountId) {
			return;
		}
		// Re-identify on account OR active-organization change so a long-lived
		// daemon keeps org attribution current after an org switch.
		const key = `${accountId}:${auth.organizationId ?? ""}`;
		if (key === identifiedKey) {
			return;
		}
		identifiedKey = key;
		identifyAccount(handle.telemetry, {
			id: accountId,
			provider: "cline",
			organizationId: auth.organizationId,
			organizationName: auth.organizationName,
			memberId: auth.memberId,
		});
	};

	refreshIdentity();
	const identityTimer = setInterval(
		refreshIdentity,
		IDENTITY_REFRESH_INTERVAL_MS,
	);
	identityTimer.unref?.();

	return {
		telemetry: handle.telemetry,
		dispose: async (): Promise<void> => {
			clearInterval(identityTimer);
			// dispose only runs on the daemon's way out; a hung exporter must
			// never keep a crashed daemon alive (holding the hub port), so
			// the flush races a hard deadline.
			let deadline: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				(async (): Promise<void> => {
					await handle.flush();
					await handle.dispose();
				})(),
				new Promise<void>((resolve) => {
					deadline = setTimeout(resolve, DISPOSE_FLUSH_TIMEOUT_MS);
					deadline.unref?.();
				}),
			]);
			clearTimeout(deadline);
		},
	};
}
