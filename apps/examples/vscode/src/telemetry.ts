import * as os from "node:os";
import {
	type ConfiguredTelemetryHandle,
	createConfiguredTelemetryHandle,
} from "@cline/core";
import {
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "@cline/shared";

export interface VscodeTelemetryOptions {
	extensionVersion: string;
	clineType: string;
	platform: string;
	platformVersion: string;
	osType?: string;
	osVersion?: string;
	isRemoteWorkspace?: boolean;
}

/**
 * Lifecycle bundle returned by {@link createVscodeTelemetry}. Identical to
 * {@link ConfiguredTelemetryHandle}; aliased here so call sites in the
 * extension can keep importing a host-named type.
 */
export type VscodeTelemetryHandle = ConfiguredTelemetryHandle;

/**
 * Centralizes VS Code telemetry service/provider creation. The host calls this
 * once during `activate()` and shares the resulting `ITelemetryService` with
 * core/hub/webview paths so a single provider lifecycle owns flushing and
 * disposal on `deactivate()`. The flush/dispose closures themselves come from
 * `createConfiguredTelemetryHandle` so the extension and the detached hub
 * daemon share one canonical implementation of the lifecycle plumbing.
 */
export function createVscodeTelemetry(
	options: VscodeTelemetryOptions,
): VscodeTelemetryHandle {
	const config = createClineTelemetryServiceConfig({
		metadata: createClineTelemetryServiceMetadata({
			extension_version: options.extensionVersion,
			cline_type: options.clineType,
			platform: options.platform,
			platform_version: options.platformVersion,
			os_type: options.osType ?? os.platform(),
			os_version: options.osVersion ?? os.version(),
			is_remote_workspace: options.isRemoteWorkspace,
		}),
	});
	return createConfiguredTelemetryHandle(config);
}
