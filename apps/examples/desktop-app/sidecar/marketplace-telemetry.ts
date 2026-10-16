import type { ITelemetryService, TelemetryProperties } from "@cline/shared";
import type { JsonRecord } from "./types";

export type MarketplaceInstallOutcome =
	| "installed"
	| "already_installed"
	| "failed";

export interface MarketplaceInstallEvent {
	type: string;
	outcome: MarketplaceInstallOutcome;
	/** Which path produced the outcome: skills-cli, github-download, already-installed. */
	method?: string;
	/** Coarse class of the skills CLI failure, when one happened. */
	cli_failure?: string;
	fallback_failed?: boolean;
}

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
		const properties: TelemetryProperties = {};
		for (const [key, value] of Object.entries(event)) {
			if (value !== undefined) properties[key] = value;
		}
		telemetry.capture({ event: "desktop.marketplace.install", properties });
	} catch {
		// Product interactions must continue if the telemetry provider fails.
	}
}
