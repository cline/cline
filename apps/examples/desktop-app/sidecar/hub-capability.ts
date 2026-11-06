import {
	type ManagedHubBuildMismatchEvent,
	resolveAgentPluginPathsWithDiagnostics,
	type WatchManagedHubBuildOptions,
} from "@cline/core";
import type { HubCapabilityName } from "@cline/shared";
import { broadcastEvent } from "./context";
import type { SidecarContext } from "./types";

/**
 * The local Hub capabilities the desktop's plugin UI slots (desktopUiSlots in
 * plugin-ui.ts) depend on. A Hub without them ignores the declared slots, so
 * the desktop offers to restart it.
 */
export const DESKTOP_REQUIRED_HUB_CAPABILITIES: readonly HubCapabilityName[] = [
	"plugins.ui",
];

/**
 * The mismatch the webview should see. A Hub without plugin UI costs nothing
 * until a plugin is enabled, so its notice waits for one; the mismatch stays
 * recorded for when it does.
 */
export function visibleHubBuildMismatch(
	ctx: SidecarContext,
): ManagedHubBuildMismatchEvent | null {
	const mismatch = ctx.hubBuildMismatch;
	if (mismatch?.reason !== "missing_capability") return mismatch;
	const enabledPlugins = resolveAgentPluginPathsWithDiagnostics({
		workspacePath: ctx.localWorkspaceRoot,
		cwd: ctx.localWorkspaceRoot,
	}).paths;
	return enabledPlugins.length > 0 ? mismatch : null;
}

export function broadcastHubBuildMismatch(ctx: SidecarContext): void {
	broadcastEvent(ctx, "hub_build_mismatch", visibleHubBuildMismatch(ctx));
}

/** Shows the managed Hub watcher's findings in every connected webview. */
export function hubBuildWatchCallbacks(
	ctx: SidecarContext,
): Pick<WatchManagedHubBuildOptions, "onMismatch" | "onResolved"> {
	return {
		onMismatch: (mismatch) => {
			ctx.hubBuildMismatch = mismatch;
			ctx.logger?.log("Managed hub build mismatch detected", {
				hubBuildId: mismatch.hubBuildId,
				hubCoreVersion: mismatch.hubCoreVersion,
				reason: mismatch.reason,
				missingCapabilities: mismatch.missingCapabilities,
			});
			broadcastHubBuildMismatch(ctx);
		},
		// Another Cline app can replace the Hub without going through this
		// app's Restart Hub, so its notice is withdrawn once the Hub is fixed.
		onResolved: () => {
			if (!ctx.hubBuildMismatch) return;
			ctx.hubBuildMismatch = null;
			ctx.logger?.log("Managed hub build mismatch resolved");
			broadcastEvent(ctx, "hub_build_mismatch", null);
		},
	};
}

/** Shows or withdraws the plugin UI notice after the enabled plugins changed. */
export function refreshHubCapabilityNotice(ctx: SidecarContext): void {
	if (ctx.hubBuildMismatch?.reason === "missing_capability") {
		broadcastHubBuildMismatch(ctx);
	}
}
