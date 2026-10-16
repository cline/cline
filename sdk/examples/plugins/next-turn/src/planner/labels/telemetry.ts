import type {
	ITelemetryService,
	PluginUiSurface,
	TelemetryProperties,
} from "@cline/shared";
import type { LabelEvent, LabelRecord } from "./schema";

/**
 * The label log's OpenTelemetry mirror. Every record the label writer accepts also goes to the host's
 * telemetry service, which the plugin context hands over as `ctx.telemetry`
 * (feature-detected; absent when the host has none). It only sees what the
 * writer already sanitized and drops the one hashed field too, so no prompt,
 * why, cue or typed text, nor a hash of it, leaves the machine. The host
 * drops these events when the person opted out, and a failing provider never
 * breaks suggestions.
 */

const TELEMETRY_PREFIX = "next_turn";
const EVENTS_COUNTER = `${TELEMETRY_PREFIX}.events`;
const DECISION_HISTOGRAM = `${TELEMETRY_PREFIX}.decision_ms`;
const SET_LATENCY_HISTOGRAM = `${TELEMETRY_PREFIX}.set_latency_ms`;
const READY_HISTOGRAM = `${TELEMETRY_PREFIX}.ready_ms`;

/** Each label under the name of what the person did: the log keeps the host writers' names, telemetry says Send and Use as the tray does. */
const TELEMETRY_ACTIONS: Record<LabelEvent, string> = {
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

const DECISION_EVENTS: ReadonlySet<LabelEvent> = new Set([
	"do",
	"adjust",
	"skip",
]);

/** Fields the label record carries that telemetry never repeats. */
const DROPPED_FIELDS: ReadonlySet<string> = new Set([
	"v",
	"at",
	"event",
	"messageHash",
	"excluded",
]);

const TRAY_SURFACES: Record<PluginUiSurface, string> = {
	desktop: "desktop-tray",
	cli: "terminal-tray",
	vscode: "vscode-tray",
	jetbrains: "jetbrains-tray",
	other: "plugin",
};

/** The tray a viewer's surface renders, or `plugin` when no viewer named one. */
export function surfaceOf(surface: PluginUiSurface | undefined): string {
	return surface ? TRAY_SURFACES[surface] : "plugin";
}

const CLIENT_SURFACES: ReadonlyMap<string, PluginUiSurface> = new Map([
	["cline-cli", "cli"],
	["cline-desktop", "desktop"],
]);

/** The surface a client name stood for before viewers named their own, or undefined for a client this plugin does not know. */
export function clientSurfaceOf(
	client: string | undefined,
): PluginUiSurface | undefined {
	return client ? CLIENT_SURFACES.get(client) : undefined;
}

/**
 * The label for a chat no viewer ever attached to, from the session's client
 * name, as labels were before viewers named their surface: the CLI's chats
 * are `terminal-tray`, the desktop's `desktop-tray`, any other `plugin`.
 */
export function legacySurfaceOf(client: string | undefined): string {
	return surfaceOf(clientSurfaceOf(client));
}

function telemetryProperties(
	record: LabelRecord,
	surface: string,
): TelemetryProperties {
	const properties: TelemetryProperties = {
		labelEvent: record.event,
		schemaVersion: record.v,
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
	if (!telemetry) return;
	const action = TELEMETRY_ACTIONS[record.event];
	try {
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
			DECISION_EVENTS.has(record.event) &&
			typeof record.msSinceExposed === "number"
		) {
			telemetry.recordHistogram(
				DECISION_HISTOGRAM,
				record.msSinceExposed,
				attributes,
				"Time from a suggestion being readable to the person acting on it",
			);
		}
		if (record.event === "offer" && typeof record.latencyMs === "number") {
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
		if (
			record.event === "set_ready" &&
			typeof record.msSinceTurnEnd === "number"
		) {
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
