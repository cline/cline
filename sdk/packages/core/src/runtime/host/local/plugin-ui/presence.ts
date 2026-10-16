import type {
	PluginUiAction,
	PluginUiSlot,
	PluginUiViewer,
} from "@cline/shared";
import {
	activityFor,
	type PerformOptions,
	type SessionUiChain,
} from "./session-chain";
import type { PluginUiStore } from "./store";
import type { PluginUiTelemetry } from "./telemetry";

/** Records the viewer before the plugin hears the verb; undefined drops a synthesized detach. */
export function applyPresence(
	{
		store,
		telemetry,
	}: {
		store: PluginUiStore;
		telemetry: Pick<PluginUiTelemetry, "captureViewersChanged">;
	},
	chain: SessionUiChain,
	sessionId: string,
	slot: PluginUiSlot,
	action: PluginUiAction,
	viewer: PluginUiViewer,
	options: PerformOptions,
): { viewer: PluginUiViewer; viewers: number } | undefined {
	const activity = activityFor(chain, slot);
	if (action.verb === "attach") {
		const attached = { ...viewer, surface: action.surface };
		const before = store.viewers(sessionId).length;
		const viewers = store.attachViewer(
			sessionId,
			attached,
			options.connectionId,
		);
		chain.attachedSlots.set(viewer.id, slot);
		activity.attaches += 1;
		activity.surfaces.add(action.surface);
		activity.peakViewers = Math.max(activity.peakViewers, viewers);
		if (before === 0) {
			telemetry.captureViewersChanged(sessionId, slot, viewers, action.surface);
		}
		return { viewer: attached, viewers };
	}
	const surface = store.viewer(sessionId, viewer.id)?.surface;
	const stamped = surface ? { ...viewer, surface } : { ...viewer };
	if (action.verb === "detach") {
		const viewers = store.detachViewer(
			sessionId,
			viewer.id,
			options.system?.connectionId,
		);
		if (viewers === undefined) {
			if (options.system) return undefined;
			return {
				viewer: stamped,
				viewers: store.viewers(sessionId).length,
			};
		}
		chain.attachedSlots.delete(viewer.id);
		activity.detaches += 1;
		if (viewers === 0) {
			telemetry.captureViewersChanged(sessionId, slot, 0, stamped.surface);
		}
		return { viewer: stamped, viewers };
	}
	if (action.verb === "exposed") activity.exposed += 1;
	if (action.verb === "signal") activity.keyInert += 1;
	return { viewer: stamped, viewers: store.viewers(sessionId).length };
}
