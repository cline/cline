import type {
	BasicLogger,
	ITelemetryService,
	PluginUiInvokeResult,
	PluginUiSlot,
	PluginUiSurface,
	PluginUiViewer,
} from "@cline/shared";
import {
	capturePluginUiInvoke,
	capturePluginUiSessionSummary,
	capturePluginUiStateDropped,
	capturePluginUiViewersChanged,
} from "../../../../services/telemetry/core-events";
import { activityFor, type SessionUiChain } from "./session-chain";
import { knownSlot } from "./slot-handler";
import type { PluginUiStateDrop, PluginUiStore } from "./store";

const GESTURE_VERBS: ReadonlySet<string> = new Set([
	"use",
	"send",
	"skip",
	"unskip",
	"refresh",
	"hide",
	"show",
	"undo",
	"clear",
]);
const DROP_REPORT_INTERVAL_MS = 60_000;
const DROP_REPORTS_BEFORE_PRUNE = 256;

export interface PluginUiTelemetryOptions {
	store: Pick<PluginUiStore, "owner" | "viewer" | "slots">;
	now(): number;
	loggerFor(sessionId: string): BasicLogger | undefined;
	telemetryFor(sessionId: string): ITelemetryService | undefined;
}

export class PluginUiTelemetry {
	private readonly dropReportedAt = new Map<string, number>();

	constructor(private readonly options: PluginUiTelemetryOptions) {}

	/** Logs and counts a dropped push, at most once per (session, plugin, reason) a minute. */
	reportDrop(drop: PluginUiStateDrop): void {
		const now = this.options.now();
		const key = JSON.stringify([drop.sessionId, drop.plugin, drop.reason]);
		const reportedAt = this.dropReportedAt.get(key);
		if (
			reportedAt !== undefined &&
			now - reportedAt < DROP_REPORT_INTERVAL_MS
		) {
			return;
		}
		if (this.dropReportedAt.size >= DROP_REPORTS_BEFORE_PRUNE) {
			for (const [reported, at] of this.dropReportedAt) {
				if (now - at >= DROP_REPORT_INTERVAL_MS) {
					this.dropReportedAt.delete(reported);
				}
			}
		}
		this.dropReportedAt.set(key, now);
		const logger = this.options.loggerFor(drop.sessionId);
		const metadata = {
			sessionId: drop.sessionId,
			plugin: drop.plugin,
			slot: drop.slot,
			reason: drop.reason,
		};
		if (drop.reason === "not_owner") {
			logger?.log("Plugin UI slot belongs to another plugin; state dropped", {
				...metadata,
				severity: "warn",
			});
		} else {
			logger?.debug("Plugin UI state dropped", metadata);
		}
		capturePluginUiStateDropped(this.options.telemetryFor(drop.sessionId), {
			plugin_name: drop.plugin,
			slot: knownSlot(drop.slot) ?? "unknown",
			reason: drop.reason,
		});
	}

	captureGesture(
		sessionId: string,
		slot: PluginUiSlot | undefined,
		verb: string | undefined,
		result: PluginUiInvokeResult,
		startedAt: number,
		viewer: PluginUiViewer,
	): void {
		if (!slot || !verb || !GESTURE_VERBS.has(verb)) return;
		const plugin = this.options.store.owner(sessionId, slot);
		const surface =
			this.options.store.viewer(sessionId, viewer.id)?.surface ??
			viewer.surface;
		capturePluginUiInvoke(this.options.telemetryFor(sessionId), {
			...(plugin ? { plugin_name: plugin } : {}),
			slot,
			verb,
			outcome: result.outcome,
			...(result.reason ? { reason: result.reason } : {}),
			latency_ms: Math.max(0, this.options.now() - startedAt),
			...(surface ? { surface } : {}),
		});
	}

	captureViewersChanged(
		sessionId: string,
		slot: PluginUiSlot,
		count: number,
		surface: PluginUiSurface | undefined,
	): void {
		capturePluginUiViewersChanged(this.options.telemetryFor(sessionId), {
			slot,
			count,
			...(surface ? { surface } : {}),
		});
	}

	captureSessionSummary(sessionId: string, chain: SessionUiChain): void {
		const telemetry = this.options.telemetryFor(sessionId);
		for (const slot of this.options.store.slots(sessionId)) {
			const activity = activityFor(chain, slot);
			const plugin = this.options.store.owner(sessionId, slot);
			capturePluginUiSessionSummary(telemetry, {
				...(plugin ? { plugin_name: plugin } : {}),
				slot,
				attaches: activity.attaches,
				detaches: activity.detaches,
				exposed: activity.exposed,
				key_inert: activity.keyInert,
				peak_viewers: activity.peakViewers,
				surfaces: [...activity.surfaces].sort(),
			});
		}
	}
}
