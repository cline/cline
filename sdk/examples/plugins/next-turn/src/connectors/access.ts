import { PERSONAL_TOOLKITS } from "../config";
import { plannerSharesChatProvider } from "../context/policy";
import type { ConnectorRole, Settings } from "../settings/settings";
import { type Access, composioConnectorId } from "./connector";

const PERSONAL_CONNECTORS: ReadonlySet<string> = new Set(
	[...PERSONAL_TOOLKITS].map(composioConnectorId),
);

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
export function connectorAccess(
	settings: Settings,
	connectorId: string,
	detected: boolean,
	chatProviderId: string | undefined,
): Access {
	const setting = settings.connectors[connectorId];
	const role: ConnectorRole = !detected
		? "off"
		: (setting?.role ??
			(PERSONAL_CONNECTORS.has(connectorId) ? "off" : "mention"));
	const scopes = setting?.scopes ?? [];
	return {
		role,
		scopes,
		readAllowed:
			role === "read" &&
			scopes.length > 0 &&
			plannerSharesChatProvider(settings, chatProviderId),
	};
}
