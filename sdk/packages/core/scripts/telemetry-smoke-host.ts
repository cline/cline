/**
 * Host-level telemetry smoke test for ENG-1902.
 *
 * Exercises the CLI memoized activation helper and the VS Code shared
 * telemetry factory using the configured OTEL telemetry pipeline + a
 * BasicLogger sink. With OTEL_TELEMETRY_ENABLED unset the OpenTelemetry
 * provider stays disabled, so we observe events through the
 * `TelemetryLoggerSink` log lines (`telemetry.event`). Activation and
 * workspace lifecycle events are routed through normal `capture` so they
 * respect the user's telemetry opt-out setting.
 */

import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
} from "@cline/shared";
import {
	captureExtensionActivated,
	identifyAccount,
} from "../src/services/telemetry/core-events";
import { createConfiguredTelemetryService } from "../src/services/telemetry/OpenTelemetryProvider";

interface CapturedLog {
	channel: "log" | "debug" | "error";
	message: string;
	metadata?: Record<string, unknown>;
}

class CapturingLogger {
	readonly entries: CapturedLog[] = [];
	log(message: string, metadata?: Record<string, unknown>): void {
		this.entries.push({ channel: "log", message, metadata });
	}
	debug(message: string, metadata?: Record<string, unknown>): void {
		this.entries.push({ channel: "debug", message, metadata });
	}
	error(message: string, metadata?: Record<string, unknown>): void {
		this.entries.push({ channel: "error", message, metadata });
	}
}

function header(t: string) {
	console.log(`\n=== ${t} ===`);
}

function dumpActivationEvents(
	logger: CapturingLogger,
	eventName: string,
): number {
	let count = 0;
	for (const e of logger.entries) {
		if (e.message !== "telemetry.event") {
			continue;
		}
		const md = (e.metadata ?? {}) as {
			event?: string;
			properties?: Record<string, unknown>;
		};
		if (md.event !== eventName) {
			continue;
		}
		count++;
		console.log(`[event] ${md.event} ${JSON.stringify(md.properties ?? {})}`);
	}
	return count;
}

/**
 * Mirror of the per-process memoized CLI activation helper from
 * `apps/cli/src/utils/telemetry.ts` (`captureCliExtensionActivated`).
 *
 * Cross-importing from `apps/cli/...` here would pull the full
 * `@cline/core` barrel which transitively requires `@cline/llms`, so
 * we replicate the exact memoization pattern locally and call the same
 * underlying core helper.
 */
interface AccountContext {
	id?: string;
	email?: string;
	provider?: string;
	organizationId?: string;
	organizationName?: string;
	memberId?: string;
}

function makeMemoizedCliActivator(telemetry: ITelemetryService) {
	let captured = false;
	return (account?: AccountContext) => {
		if (captured) {
			return;
		}
		captured = true;
		// Mirror the real apps/cli helper: identify the active account/org
		// (mapped onto telemetry common properties via `identifyAccount`)
		// strictly before emitting `user.extension_activated`, so the
		// activation event itself carries `organization_id` and friends.
		if (account) {
			identifyAccount(telemetry, account);
		}
		captureExtensionActivated(telemetry);
	};
}

async function smokeCli() {
	header(
		"CLI: memoized captureCliExtensionActivated equivalent (only first call should emit)",
	);
	const logger = new CapturingLogger();
	const cfg = createClineTelemetryServiceConfig({
		metadata: {
			extension_version: "0.0.0-smoke",
			cline_type: "cli",
			platform: "smoke-cli",
			platform_version: process.version,
			os_type: process.platform,
			os_version: "smoke",
		},
	});
	const { telemetry, provider } = createConfiguredTelemetryService({
		...cfg,
		logger,
	});
	const captureCliActivation = makeMemoizedCliActivator(telemetry);
	captureCliActivation();
	captureCliActivation(); // memoized: must NOT emit a second event.
	const captured = dumpActivationEvents(logger, "user.extension_activated");
	console.log(
		`captured ${captured} user.extension_activated event(s); expected exactly 1.`,
	);
	await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
}

async function smokeCliAuthenticated() {
	header(
		"CLI: authenticated captureCliExtensionActivated should carry organization_id",
	);
	const logger = new CapturingLogger();
	const cfg = createClineTelemetryServiceConfig({
		metadata: {
			extension_version: "0.0.0-smoke",
			cline_type: "cli",
			platform: "smoke-cli",
			platform_version: process.version,
			os_type: process.platform,
			os_version: "smoke",
		},
	});
	const { telemetry, provider } = createConfiguredTelemetryService({
		...cfg,
		logger,
	});
	const captureCliActivation = makeMemoizedCliActivator(telemetry);
	captureCliActivation({
		id: "user-smoke",
		email: "user@example.com",
		provider: "cline",
		organizationId: "org-smoke",
		organizationName: "Smoke Org",
		memberId: "member-smoke",
	});
	const captured = dumpActivationEvents(logger, "user.extension_activated");
	console.log(
		`captured ${captured} user.extension_activated event(s); expected exactly 1, with organization_id="org-smoke".`,
	);
	await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
}

async function smokeVscode() {
	header("VS Code: createVscodeTelemetry-equivalent shared service");
	const logger = new CapturingLogger();
	const cfg = createClineTelemetryServiceConfig({
		metadata: {
			extension_version: "0.0.0-smoke",
			cline_type: "VSCode Extension",
			platform: "Visual Studio Code",
			platform_version: "1.113.0",
			os_type: process.platform,
			os_version: "smoke",
		},
	});
	const { telemetry, provider } = createConfiguredTelemetryService({
		...cfg,
		logger,
	});
	// Single shared activation event for the VS Code host
	captureExtensionActivated(telemetry);
	const captured = dumpActivationEvents(logger, "user.extension_activated");
	console.log(
		`captured ${captured} user.extension_activated event(s); expected exactly 1.`,
	);
	await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
}

async function main() {
	await smokeCli();
	await smokeCliAuthenticated();
	await smokeVscode();
	header("Done");
}

main().catch((err) => {
	console.error("host smoke test failed:", err);
	process.exitCode = 1;
});
