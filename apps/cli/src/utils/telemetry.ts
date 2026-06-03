import {
	type BasicLogger,
	captureExtensionActivated,
	createClineTelemetryServiceConfig,
	createConfiguredTelemetryHandle,
	type ITelemetryService,
	identifyAccount,
	registerDisposable,
	TelemetryLoggerSink,
} from "@cline/core";
import { getCliBuildInfo } from "./common";
import {
	markActivationCaptured,
	wasActivationCaptured,
} from "./telemetry.activation-gate";

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
		const handle = createConfiguredTelemetryHandle({
			...config,
			logger,
		});
		telemetrySingleton = {
			telemetry: handle.telemetry,
			loggerAttached: Boolean(logger),
			dispose: handle.dispose,
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

/**
 * Optional account context used to enrich the CLI activation event. Mirrors
 * the legacy `cline` extension behavior where `user.extension_activated`
 * carries `organization_id`, `organization_name`, and `member_id` derived
 * from the active Cline organization when the user is authenticated.
 *
 * All fields are optional. When omitted, the activation event is emitted
 * without account/organization properties (matching unauthenticated runs).
 */
export interface CliTelemetryAccountContext {
	id?: string;
	email?: string;
	provider?: string;
	organizationId?: string;
	organizationName?: string;
	memberId?: string;
}

/**
 * Attaches account/organization context to the CLI telemetry service so
 * subsequent events (including the `user.extension_activated` activation
 * event when called before {@link captureCliExtensionActivated}) carry
 * `organization_id`, `organization_name`, `member_id`, etc.
 *
 * Safe to call multiple times; the latest values win, mirroring the legacy
 * singleton-based behavior.
 */
export function identifyCliTelemetryAccount(
	account: CliTelemetryAccountContext,
	logger?: BasicLogger,
): void {
	identifyAccount(getCliTelemetryService(logger), account);
}

/**
 * Memoized emission of the `user.extension_activated` event. Safe to call
 * multiple times per process; only the first call emits. Routed through the
 * normal capture path so the user's telemetry opt-out setting is honored.
 *
 * When `account` is provided, `identifyAccount` is called first so the
 * activation event payload includes `organization_id`, `organization_name`,
 * `member_id`, and similar account identifiers — matching the legacy CLI
 * funnel observed in `otel.otel_logs`.
 *
 * The memoization gate lives in {@link ./telemetry.activation-gate} so a
 * test-only reset helper can be exposed from a separate `*.test-helpers.ts`
 * file rather than from this production module.
 */
export function captureCliExtensionActivated(
	logger?: BasicLogger,
	account?: CliTelemetryAccountContext,
): void {
	if (wasActivationCaptured()) {
		return;
	}
	markActivationCaptured();
	const telemetry = getCliTelemetryService(logger);
	if (account) {
		identifyAccount(telemetry, account);
	}
	captureExtensionActivated(telemetry);
}
