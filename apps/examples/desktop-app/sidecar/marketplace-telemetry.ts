import {
	captureMarketplaceInstall,
	type MarketplaceInstallProperties,
} from "@cline/core";
import type { ITelemetryService } from "@cline/shared";
import type { JsonRecord } from "./types";

export type MarketplaceInstallEvent = MarketplaceInstallProperties;

/** The marketplace entry type a desktop install request asked for. */
export function requestedMarketplaceType(
	args: Record<string, unknown> | undefined,
): string {
	const entry =
		args?.entry && typeof args.entry === "object"
			? (args.entry as Record<string, unknown>)
			: args;
	return typeof entry?.type === "string" ? entry.type : "unknown";
}

export function marketplaceInstallEventFromResult(result: {
	type: string;
	details?: JsonRecord;
}): MarketplaceInstallEvent {
	const details = result.details ?? {};
	const method =
		typeof details.method === "string" ? details.method : undefined;
	return {
		type: result.type,
		outcome: method === "already-installed" ? "already_installed" : "installed",
		method,
		cli_failure:
			typeof details.cli_failure === "string" ? details.cli_failure : undefined,
	};
}

export function marketplaceInstallEventFromFailure(
	type: string,
	telemetry: JsonRecord | undefined,
): MarketplaceInstallEvent {
	return {
		type,
		outcome: "failed",
		method:
			typeof telemetry?.method === "string" ? telemetry.method : undefined,
		cli_failure:
			typeof telemetry?.cli_failure === "string"
				? telemetry.cli_failure
				: undefined,
		fallback_failed: telemetry?.fallback_failed === true ? true : undefined,
	};
}

export function captureMarketplaceInstallEvent(
	telemetry: ITelemetryService | undefined,
	event: MarketplaceInstallEvent,
): void {
	try {
		if (!telemetry?.isEnabled()) return;
		captureMarketplaceInstall(telemetry, event);
	} catch {
		// Product interactions must continue if the telemetry provider fails.
	}
}
