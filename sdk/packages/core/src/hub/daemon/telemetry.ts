import { release } from "node:os";
import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
} from "@cline/shared";
import { createConfiguredTelemetryHandle } from "../../services/telemetry/OpenTelemetryProvider";
import { CORE_BUILD_VERSION } from "../../version";

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

	return {
		telemetry: handle.telemetry,
		dispose: async (): Promise<void> => {
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
