import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	PluginUiInvokeInput,
} from "@cline/shared";
import type { HubConnectionAuthority } from "../command-transport";
import { logHubBoundaryError } from "../hub-server-logging";
import {
	buildHubEvent,
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
} from "./context";

function pluginUiViewerId(
	envelope: HubCommandEnvelope,
	authority: HubConnectionAuthority | undefined,
): string {
	return authority?.clientId ?? (envelope.clientId?.trim() || "hub");
}

/**
 * Never fails for plugin reasons: a missing session, slot or plugin, and
 * any throw, come back as `ok:true` with no states or `unavailable`, so no
 * plugin text reaches a captured error.
 */
export async function handlePluginUiCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	authority: HubConnectionAuthority | undefined,
): Promise<HubReplyEnvelope> {
	const service = ctx.sessionHost.pluginUi;
	if (!service) {
		return errorReply(
			envelope,
			"plugin_ui_unavailable",
			"This runtime does not support plugin UI",
		);
	}
	const isGet = envelope.command === "plugins.ui.get";
	const nothing = isGet ? { states: [] } : { outcome: "unavailable" };
	const sessionId = envelope.sessionId?.trim();
	if (!sessionId) {
		return okReply(envelope, nothing);
	}
	try {
		if (isGet) {
			return okReply(envelope, { states: await service.get({ sessionId }) });
		}
		const viewerId = pluginUiViewerId(envelope, authority);
		const clientType = ctx.clients.get(viewerId)?.clientType;
		const result = await service.invoke(
			{
				sessionId,
				slot: envelope.payload?.slot,
				action: envelope.payload?.action,
			} as PluginUiInvokeInput,
			{ id: viewerId, ...(clientType ? { clientType } : {}) },
			authority?.connectionId,
		);
		return okReply(envelope, { ...result });
	} catch {
		return okReply(envelope, nothing);
	}
}

export function reissuePluginUiState(
	ctx: HubTransportContext,
	sessionId: string,
	isSubscribed: () => boolean,
	deliver: (event: HubEventEnvelope) => void,
): void {
	const pluginUi = ctx.sessionHost.pluginUi;
	if (!pluginUi) {
		return;
	}
	void pluginUi
		.get({ sessionId })
		.then((states) => {
			queueMicrotask(() => {
				if (!isSubscribed()) {
					return;
				}
				for (const state of states) {
					try {
						deliver(
							buildHubEvent(
								"plugins.ui.state",
								state as unknown as Record<string, unknown>,
								state.sessionId,
							),
						);
					} catch (error) {
						logHubBoundaryError(
							"listener threw while re-issuing plugin ui state",
							error,
						);
					}
				}
			});
		})
		.catch(() => {});
}

export function releasePluginUiViewer(
	ctx: HubTransportContext,
	clientId: string,
	authority: HubConnectionAuthority | undefined,
	payload: HubCommandEnvelope["payload"],
): void {
	ctx.sessionHost.pluginUi?.detachViewer(
		clientId,
		authority?.connectionId ?? readUnregisterConnectionId(payload),
	);
}

/** A client that detaches from a session stops viewing that session's plugin UI. */
export function releasePluginUiSessionViewer(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	authority: HubConnectionAuthority | undefined,
): void {
	const sessionId = extractSessionId(envelope);
	if (!sessionId) return;
	ctx.sessionHost.pluginUi?.detachViewer(
		pluginUiViewerId(envelope, authority),
		authority?.connectionId,
		sessionId,
	);
}

function readUnregisterConnectionId(
	payload: HubCommandEnvelope["payload"],
): string | undefined {
	const connectionId = payload?.connectionId;
	return typeof connectionId === "string" && connectionId
		? connectionId
		: undefined;
}
