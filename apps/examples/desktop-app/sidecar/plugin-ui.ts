import {
	type ClineCore,
	type ManagedHubBuildMismatchEvent,
	resolveAgentPluginPathsWithDiagnostics,
} from "@cline/core";
import type {
	HubCapabilityName,
	PluginUiInvokeInput,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
} from "@cline/shared";
import {
	broadcastEvent,
	getRuntimeBinding,
	getSessionRuntimeBinding,
	sendEvent,
} from "./context";
import type {
	SessionRuntimeBinding,
	SidecarContext,
	SidecarWebSocketClient,
} from "./types";

const COMPOSER_SUGGESTIONS = "composer.suggestions";

/**
 * The plugin UI slots the desktop renders, declared on every session it
 * starts. Only local sessions get the tray in v1, so an SSH session declares
 * none and its plugins are offered no slot API.
 */
export function desktopUiSlots(
	binding: Pick<SessionRuntimeBinding, "kind">,
): string[] | undefined {
	return binding.kind === "local" ? [COMPOSER_SUGGESTIONS] : undefined;
}

/**
 * The local Hub capabilities those slots depend on. A Hub without them
 * ignores the declared slots, so the desktop offers to restart it.
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

/** Shows or withdraws the plugin UI notice after the enabled plugins changed. */
export function refreshHubCapabilityNotice(ctx: SidecarContext): void {
	if (ctx.hubBuildMismatch?.reason === "missing_capability") {
		broadcastHubBuildMismatch(ctx);
	}
}

function readSessionId(args: Record<string, unknown> | undefined): string {
	const sessionId =
		typeof args?.sessionId === "string" ? args.sessionId.trim() : "";
	if (!sessionId) throw new Error("sessionId is required");
	return sessionId;
}

function sessionBinding(
	ctx: SidecarContext,
	sessionId: string,
	args: Record<string, unknown> | undefined,
): SessionRuntimeBinding {
	const environmentId =
		typeof args?.environmentId === "string" ? args.environmentId : undefined;
	return getSessionRuntimeBinding(ctx, sessionId, environmentId);
}

function readVerb(action: unknown): unknown {
	return action && typeof action === "object"
		? (action as { verb?: unknown }).verb
		: undefined;
}

function addPluginUiViewer(
	ctx: SidecarContext,
	sessionId: string,
	environmentId: string,
	socket: SidecarWebSocketClient,
): void {
	const views = ctx.pluginUiViews;
	if (!views) return;
	const sockets =
		views.get(sessionId)?.sockets ?? new Set<SidecarWebSocketClient>();
	sockets.add(socket);
	views.set(sessionId, { environmentId, sockets });
}

/**
 * The environment whose hub held the lease when `socket` was the session's
 * last viewer, so that lease should end there; undefined otherwise.
 */
function removePluginUiViewer(
	ctx: SidecarContext,
	sessionId: string,
	socket: SidecarWebSocketClient,
): string | undefined {
	const viewers = ctx.pluginUiViews?.get(sessionId);
	if (!viewers?.sockets.delete(socket) || viewers.sockets.size > 0) {
		return undefined;
	}
	ctx.pluginUiViews?.delete(sessionId);
	return viewers.environmentId;
}

export async function getPluginUiStates(
	ctx: SidecarContext,
	args: Record<string, unknown> | undefined,
): Promise<PluginUiStateEnvelope[]> {
	const sessionId = readSessionId(args);
	return await sessionBinding(ctx, sessionId, args).sessionManager.pluginUi.get(
		{ sessionId },
	);
}

/**
 * Every webview socket shares the sidecar's one hub viewer, so presence is
 * counted here: every `attach` is forwarded (its reply carries the epoch the
 * webview re-attaches by), and a `detach` reaches the hub only when the
 * session's last socket leaves.
 */
export async function invokePluginUi(
	ctx: SidecarContext,
	args: Record<string, unknown> | undefined,
	connection: SidecarWebSocketClient | undefined,
): Promise<PluginUiInvokeResult> {
	if (!connection?.data?.canApproveTools) {
		throw new Error("plugin UI actions require a trusted desktop connection");
	}
	const sessionId = readSessionId(args);
	const verb = readVerb(args?.action);
	if (typeof args?.slot !== "string" || typeof verb !== "string") {
		return { outcome: "rejected" };
	}
	let binding: SessionRuntimeBinding;
	if (verb === "detach") {
		const environmentId = removePluginUiViewer(ctx, sessionId, connection);
		if (environmentId === undefined) return { outcome: "ok" };
		binding = getRuntimeBinding(ctx, environmentId);
	} else {
		binding = sessionBinding(ctx, sessionId, args);
		if (verb === "attach") {
			addPluginUiViewer(ctx, sessionId, binding.environmentId, connection);
		}
	}
	return await binding.sessionManager.pluginUi.invoke({
		sessionId,
		slot: args.slot,
		action: args.action,
	} as PluginUiInvokeInput);
}

async function sendPresence(
	pluginUi: ClineCore["pluginUi"],
	sessionId: string,
	action: PluginUiInvokeInput["action"],
): Promise<void> {
	await pluginUi.invoke({ sessionId, slot: COMPOSER_SUGGESTIONS, action });
}

/** A closed webview socket stops viewing every session it attached to. */
export function releasePluginUiViewer(
	ctx: SidecarContext,
	socket: SidecarWebSocketClient,
): void {
	for (const sessionId of [...(ctx.pluginUiViews?.keys() ?? [])]) {
		const environmentId = removePluginUiViewer(ctx, sessionId, socket);
		if (environmentId === undefined) continue;
		void Promise.resolve()
			.then(() =>
				sendPresence(
					getRuntimeBinding(ctx, environmentId).sessionManager.pluginUi,
					sessionId,
					{ verb: "detach" },
				),
			)
			.catch((error: unknown) => {
				ctx.logger?.log("Failed to detach plugin UI viewer", {
					sessionId,
					error,
					severity: "warn",
				});
			});
	}
}

/**
 * A same-id rebuild starts a new epoch with no viewers, so a session the
 * webview still shows is attached again for it.
 *
 * When the new epoch's slot is empty, no plugin owns it yet and nothing
 * would replace the set the webview kept from the old epoch, so the webview
 * gets an empty state for the new epoch; any push the plugin makes later
 * orders after it.
 */
export function reattachPluginUiViewers(
	ctx: SidecarContext,
	manager: ClineCore,
	sessionId: string,
): void {
	const viewers = ctx.pluginUiViews?.get(sessionId);
	if (!viewers?.sockets.size) return;
	void Promise.resolve()
		.then(() =>
			manager.pluginUi.invoke({
				sessionId,
				slot: COMPOSER_SUGGESTIONS,
				action: { verb: "attach", surface: "desktop" },
			}),
		)
		.then((reply) => {
			if (reply.epoch === undefined || reply.state) return;
			const emptied: PluginUiStateEnvelope = {
				sessionId,
				slot: COMPOSER_SUGGESTIONS,
				plugin: "",
				epoch: reply.epoch,
				seq: 0,
				state: null,
			};
			sendEvent(ctx, "plugin_ui_state", {
				environmentId: viewers.environmentId,
				sessionId,
				envelope: emptied,
			});
		})
		.catch((error: unknown) => {
			ctx.logger?.log("Failed to re-attach plugin UI viewer", {
				sessionId,
				error,
				severity: "warn",
			});
		});
}
