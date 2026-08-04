import {
	isTelemetryOptedOutGlobally,
	normalizeSdkError,
	SDK_ERROR_TELEMETRY_EVENT,
	type TelemetryProperties,
} from "@cline/core";
import type { JsonRecord, SidecarContext } from "./types";

/**
 * Webview telemetry relay. The webview cannot (and should not) talk to the
 * OTel endpoint itself — it holds no credentials — so it forwards reports
 * over the transport via the `report_client_event` command and the sidecar
 * captures them through its existing telemetry handle, which stamps
 * `cline_type: "desktop"` and `extension_version` (webview and sidecar ship
 * from the same package.json, so one version stamp covers both).
 *
 * Webview input is untrusted-ish: only allowlisted events pass, only
 * allowlisted properties per event pass, strings are capped, and the
 * handler never throws back into the transport.
 */

export const DESKTOP_COMMAND_FAILED_EVENT = "desktop.command_failed";

const MAX_STRING_LENGTH = 500;

/** `component` values a webview report may carry; anything else is replaced. */
const WEBVIEW_COMPONENT = "desktop.webview";

const COMMAND_FAILURE_REASONS = new Set([
	"timeout",
	"transport_unavailable",
	"error",
]);

// Command names are our own snake_case identifiers; anything else is
// replaced so a misbehaving client cannot inflate property cardinality.
const COMMAND_NAME_PATTERN = /^[a-z0-9_.]{1,64}$/;

const CLIENT_EVENT_PROPERTY_ALLOWLIST: Record<string, readonly string[]> = {
	[SDK_ERROR_TELEMETRY_EVENT]: [
		"operation",
		"severity",
		"handled",
		"error_type",
		"error_message",
	],
	[DESKTOP_COMMAND_FAILED_EVENT]: [
		"command",
		"duration_ms",
		"reason",
		"transport_state",
	],
};

const SDK_ERROR_SEVERITIES = new Set([
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
]);

function sanitizeValue(value: unknown): string | number | boolean | undefined {
	if (typeof value === "string") {
		return value.length > MAX_STRING_LENGTH
			? value.slice(0, MAX_STRING_LENGTH)
			: value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "boolean") {
		return value;
	}
	return undefined;
}

function sanitizeProperties(
	event: string,
	raw: JsonRecord,
): TelemetryProperties | undefined {
	const allowedKeys = CLIENT_EVENT_PROPERTY_ALLOWLIST[event];
	if (!allowedKeys) {
		return undefined;
	}
	const properties: TelemetryProperties = {};
	for (const key of allowedKeys) {
		const value = sanitizeValue(raw[key]);
		if (value !== undefined) {
			properties[key] = value;
		}
	}

	if (event === SDK_ERROR_TELEMETRY_EVENT) {
		// Re-normalize through the shared helper so webview-supplied messages
		// get the same secret/path redaction and truncation as every other
		// sdk.error producer.
		const normalized = normalizeSdkError({
			name:
				typeof properties.error_type === "string"
					? properties.error_type
					: "Error",
			message:
				typeof properties.error_message === "string"
					? properties.error_message
					: "Unknown error",
		});
		properties.error_type = normalized.error_type;
		properties.error_message = normalized.error_message;
		if (
			typeof properties.severity !== "string" ||
			!SDK_ERROR_SEVERITIES.has(properties.severity)
		) {
			properties.severity = "error";
		}
		if (typeof properties.handled !== "boolean") {
			properties.handled = false;
		}
		if (typeof properties.operation !== "string" || !properties.operation) {
			properties.operation = "unknown";
		}
	}

	if (event === DESKTOP_COMMAND_FAILED_EVENT) {
		if (
			typeof properties.command !== "string" ||
			!COMMAND_NAME_PATTERN.test(properties.command)
		) {
			properties.command = "invalid_command_name";
		}
		if (
			typeof properties.reason !== "string" ||
			!COMMAND_FAILURE_REASONS.has(properties.reason)
		) {
			properties.reason = "error";
		}
	}

	// The relay decides attribution, not the webview.
	properties.component = WEBVIEW_COMPONENT;
	return properties;
}

/**
 * Handles the `report_client_event` transport command. Must never throw:
 * this runs in the transport dispatch path and a reporting failure must
 * not surface as a command error in the UI.
 */
export function handleReportClientEvent(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): { reported: boolean } {
	try {
		const event = typeof args?.event === "string" ? args.event : "";
		const rawProperties =
			args?.properties &&
			typeof args.properties === "object" &&
			!Array.isArray(args.properties)
				? (args.properties as JsonRecord)
				: {};
		const properties = sanitizeProperties(event, rawProperties);
		if (!properties) {
			return { reported: false };
		}
		// Single enforcement point for the user's telemetry opt-out: the
		// webview does not gate reports itself, this check does. Read at
		// capture time so a mid-session toggle takes effect immediately.
		if (!ctx.telemetry || isTelemetryOptedOutGlobally()) {
			return { reported: false };
		}
		ctx.telemetry.capture({ event, properties });
		return { reported: true };
	} catch (error) {
		ctx.logger?.debug?.("Failed to relay webview client event", { error });
		return { reported: false };
	}
}
