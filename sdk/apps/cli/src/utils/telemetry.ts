import {
	type BasicLogger,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryService,
	type ITelemetryService,
	registerDisposable,
	TelemetryLoggerSink,
} from "@clinebot/core";
import { getCliBuildInfo } from "./common";

type MutableTelemetryService = ITelemetryService & {
	addAdapter?: (adapter: TelemetryLoggerSink) => void;
};

let telemetrySingleton:
	| {
			telemetry: ITelemetryService;
			dispose: () => Promise<void>;
			loggerAttached: boolean;
	  }
	| undefined;

export function getCliTelemetryService(
	logger?: BasicLogger,
): ITelemetryService {
	if (!telemetrySingleton) {
		const { version, name, os_type, os_version } = getCliBuildInfo();
		const config = createClineTelemetryServiceConfig({
			metadata: {
				extension_version: version,
				cline_type: "cli",
				platform: name,
				platform_version: process.version,
				os_type,
				os_version,
			},
		});
		const { telemetry, provider } = createConfiguredTelemetryService({
			...config,
			logger,
		});
		const dispose = async () => {
			await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
		};
		telemetrySingleton = {
			telemetry,
			loggerAttached: Boolean(logger),
			dispose,
		};
		registerDisposable(disposeCliTelemetryService);
	}
	if (
		logger &&
		telemetrySingleton.loggerAttached !== true &&
		typeof (telemetrySingleton.telemetry as MutableTelemetryService)
			.addAdapter === "function"
	) {
		(telemetrySingleton.telemetry as MutableTelemetryService).addAdapter?.(
			new TelemetryLoggerSink({ logger }),
		);
		telemetrySingleton.loggerAttached = true;
	}
	return telemetrySingleton.telemetry;
}

export async function disposeCliTelemetryService(): Promise<void> {
	if (!telemetrySingleton) {
		return;
	}
	const current = telemetrySingleton;
	telemetrySingleton = undefined;
	await current.dispose();
}
