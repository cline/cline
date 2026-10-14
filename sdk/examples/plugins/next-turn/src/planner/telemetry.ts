import type { ITelemetryService, TelemetryProperties } from "@cline/shared";
import type { LabelEvent, LabelRecord } from "./labels";

/**
 * The label log's OpenTelemetry mirror. Every record the label writer accepts also goes to the host's
 * telemetry service, which the plugin context hands over as `ctx.telemetry`
 * (feature-detected; absent when the host has none). It only sees what the
 * writer already sanitized and drops the one hashed field too, so no prompt,
 * why, cue or typed text, nor a hash of it, leaves the machine (ADR-0008).
 * Export follows the host: nothing is sent when the person opted out
 * (`isEnabled()`), and a failing provider never breaks suggestions.
 *
 * The event names use this plugin's prefix.
 */

export const TELEMETRY_PREFIX = "next_turn";
export const EVENTS_COUNTER = `${TELEMETRY_PREFIX}.events`;
export const DECISION_HISTOGRAM = `${TELEMETRY_PREFIX}.decision_ms`;
export const SET_LATENCY_HISTOGRAM = `${TELEMETRY_PREFIX}.set_latency_ms`;
export const READY_HISTOGRAM = `${TELEMETRY_PREFIX}.ready_ms`;

/** Each label under the name of what the person did: the log keeps 03's names, telemetry says Send and Use as the tray does. */
export const TELEMETRY_ACTIONS: Record<LabelEvent, string> = {
	offer: "set_served",
	lineage: "lineage",
	set_ready: "set_ready",
	exposed: "exposed",
	highlight_move: "highlight_moved",
	do: "sent",
	adjust: "used",
	adjust_sent: "used_and_sent",
	adjust_abandoned: "used_and_abandoned",
	skip: "skipped",
	undo_skip: "skip_undone",
	undo_adjust: "use_undone",
	undo_turn: "turn_undone",
	reroll: "rerolled",
	cancel_pending: "send_cancelled",
	refused_stale: "refused",
	key_inert: "key_inert",
	superseded: "superseded",
	typed_instead: "typed_instead",
	ignored: "ignored",
	hidden_by_user: "hidden",
};

const DECISION_ACTIONS: ReadonlySet<string> = new Set([
	"sent",
	"used",
	"skipped",
]);

/** Fields the label record carries that telemetry never repeats. */
const DROPPED_FIELDS: ReadonlySet<string> = new Set([
	"v",
	"at",
	"event",
	"messageHash",
	"excluded",
]);

/** `desktop-tray`, `terminal-tray`, or `plugin` for a host this plugin does not know. */
export function surfaceOf(client: string | undefined): string {
	const name = client?.toLowerCase() ?? "";
	if (name.includes("desktop")) return "desktop-tray";
	if (name.includes("cli")) return "terminal-tray";
	return "plugin";
}

export function telemetryProperties(
	record: LabelRecord,
	surface: string,
): TelemetryProperties {
	const properties: TelemetryProperties = {
		labelEvent: typeof record.event === "string" ? record.event : null,
		schemaVersion: typeof record.v === "number" ? record.v : null,
		surface,
	};
	for (const [key, value] of Object.entries(record)) {
		if (DROPPED_FIELDS.has(key)) continue;
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		)
			properties[key] = value;
		else if (Array.isArray(value)) properties[key] = value.join(",");
	}
	if (Array.isArray(record.excluded))
		properties.excludedCount = record.excluded.length;
	return properties;
}

/** Mirrors one record the writer accepted; never throws. */
export function captureLabel(
	telemetry: ITelemetryService | undefined,
	surface: string,
	record: LabelRecord,
): void {
	const action = TELEMETRY_ACTIONS[record.event as LabelEvent];
	if (!action || !telemetry) return;
	try {
		if (!telemetry.isEnabled()) return;
		telemetry.capture({
			event: `${TELEMETRY_PREFIX}.${action}`,
			properties: telemetryProperties(record, surface),
		});
		const attributes: TelemetryProperties = { action };
		if (typeof record.kind === "string") attributes.kind = record.kind;
		if (typeof record.input === "string") attributes.input = record.input;
		telemetry.recordCounter(
			EVENTS_COUNTER,
			1,
			attributes,
			"Suggestion events by action",
		);
		if (
			DECISION_ACTIONS.has(action) &&
			typeof record.msSinceExposed === "number"
		) {
			telemetry.recordHistogram(
				DECISION_HISTOGRAM,
				record.msSinceExposed,
				attributes,
				"Time from a suggestion being readable to the person acting on it",
			);
		}
		if (action === "set_served" && typeof record.latencyMs === "number") {
			telemetry.recordHistogram(
				SET_LATENCY_HISTOGRAM,
				record.latencyMs,
				{
					cueCode:
						typeof record.cueCode === "string" ? record.cueCode : "unknown",
					fallback: record.fallback === true,
					planner:
						typeof record.planner === "string" ? record.planner : "rules",
				},
				"Time to build one suggestion set",
			);
		}
		if (action === "set_ready" && typeof record.msSinceTurnEnd === "number") {
			telemetry.recordHistogram(
				READY_HISTOGRAM,
				record.msSinceTurnEnd,
				{ beforeInput: record.beforeInput === true },
				"Time from a turn ending to its suggestions being on screen",
			);
		}
	} catch {
		return;
	}
}
