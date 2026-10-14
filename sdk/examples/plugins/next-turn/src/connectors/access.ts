import { PERSONAL_TOOLKITS } from "../config";
import { plannerSharesChatProvider } from "../context/policy";
import {
	type ConnectorRole,
	connectorRole,
	type Settings,
} from "../settings/settings";
import type { Access } from "./connector";

/**
 * A connector's effective access:
 * - **Off** unless detected; **Mention** by default once detected, except
 *   toolkits that are personal or speak for the person (Gmail, Slack), which
 *   stay Off until chosen;
 * - **Read** only by explicit choice, only for the scopes the person ticked,
 *   and only while the planner sends to the chat's own provider. Choosing
 *   another model for suggestions turns Read off; the role is kept, so it
 *   comes back when the model does.
 */
export function defaultRole(
	connectorId: string,
	detected: boolean,
): ConnectorRole {
	if (!detected) return "off";
	const toolkit = connectorId.startsWith("composio:")
		? connectorId.slice("composio:".length)
		: undefined;
	return toolkit && PERSONAL_TOOLKITS.has(toolkit) ? "off" : "mention";
}

export function connectorAccess(
	settings: Settings,
	connectorId: string,
	detected: boolean,
	chatProviderId: string | undefined,
): Access {
	const role = detected
		? connectorRole(settings, connectorId, defaultRole(connectorId, true))
		: "off";
	const scopes = settings.connectors[connectorId]?.scopes ?? [];
	return {
		role,
		scopes,
		readAllowed:
			role === "read" &&
			scopes.length > 0 &&
			plannerSharesChatProvider(settings, chatProviderId),
	};
}
