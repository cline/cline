import { release } from "node:os";
import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
} from "@cline/shared";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { identifyAccount } from "../../services/telemetry/core-events";
import { createConfiguredTelemetryHandle } from "../../services/telemetry/OpenTelemetryProvider";
import { CORE_BUILD_VERSION } from "../../version";

const IDENTITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface HubDaemonTelemetry {
	readonly telemetry: ITelemetryService;
	/** Flushes pending batches and disposes the underlying provider. */
	dispose(): Promise<void>;
}

function resolveCachedClineAccountId(): string | undefined {
	try {
		return (
			new ProviderSettingsManager()
				.getProviderSettings("cline")
				?.auth?.accountId?.trim() || undefined
		);
	} catch {
		// Telemetry identity must never interfere with daemon operation.
		return undefined;
	}
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
			cline_type: "cli",
			platform: "cline-hub-daemon",
			platform_version: process.version,
			os_type: process.platform,
			os_version: release(),
		},
	});
	const handle = createConfiguredTelemetryHandle(config);

	let identifiedAccountId: string | undefined;
	const refreshIdentity = (): void => {
		const accountId = resolveCachedClineAccountId();
		if (!accountId || accountId === identifiedAccountId) {
			return;
		}
		identifiedAccountId = accountId;
		identifyAccount(handle.telemetry, { id: accountId, provider: "cline" });
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
			await handle.flush();
			await handle.dispose();
		},
	};
}
