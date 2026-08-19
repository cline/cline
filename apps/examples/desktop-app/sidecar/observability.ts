import * as os from "node:os";
import {
	captureExtensionActivated,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	identifyAccount,
	ProviderSettingsManager,
	setSdkLogger,
} from "@cline/core";
import { version } from "../package.json";
import {
	createDesktopLoggerAdapter,
	type DesktopLoggerAdapter,
} from "./logging";

export interface DesktopObservability {
	readonly logger: DesktopLoggerAdapter["core"];
	readonly telemetry: ITelemetryService;
	dispose(): Promise<void>;
}

export function createDesktopObservability(): DesktopObservability {
	const loggerAdapter = createDesktopLoggerAdapter();
	const logger = loggerAdapter.core;
	setSdkLogger(logger);

	const telemetryHandle = createConfiguredTelemetryHandle({
		...createClineTelemetryServiceConfig({
			metadata: {
				extension_version: version,
				cline_type: "desktop",
				platform: "Cline Code",
				platform_version: process.version,
				os_type: os.platform(),
				os_version: os.version(),
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
