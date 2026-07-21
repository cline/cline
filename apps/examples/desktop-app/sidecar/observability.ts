import {
	captureExtensionActivated,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	identifyAccount,
	ProviderSettingsManager,
	setSdkLogger,
} from "@cline/core";
import type { DesktopRuntimeInfo } from "../shared/desktop-runtime-info";
import {
	createDesktopLoggerAdapter,
	type DesktopLoggerAdapter,
} from "./logging";

export interface DesktopObservability {
	readonly logger: DesktopLoggerAdapter["core"];
	readonly telemetry: ITelemetryService;
	dispose(): Promise<void>;
}

export function createDesktopObservability(
	runtimeInfo: DesktopRuntimeInfo,
): DesktopObservability {
	const loggerAdapter = createDesktopLoggerAdapter();
	const logger = loggerAdapter.core;
	setSdkLogger(logger);

	const telemetryHandle = createConfiguredTelemetryHandle({
		...createClineTelemetryServiceConfig({
			metadata: {
				extension_version: runtimeInfo.app.version,
				cline_type: "desktop",
				platform: runtimeInfo.app.name,
				platform_version: runtimeInfo.app.version,
				os_type: runtimeInfo.os.platform,
				os_version: runtimeInfo.os.version,
			},
		}),
		logger,
	});
	const telemetry = telemetryHandle.telemetry;
	const auth = new ProviderSettingsManager().getProviderSettings("cline")?.auth;
	if (auth?.accountId) {
		identifyAccount(telemetry, {
			id: auth.accountId,
			provider: "cline",
		});
	}
	captureExtensionActivated(telemetry);

	let disposed = false;
	return {
		logger,
		telemetry,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await telemetryHandle.dispose();
			setSdkLogger(undefined);
			loggerAdapter.dispose();
		},
	};
}
