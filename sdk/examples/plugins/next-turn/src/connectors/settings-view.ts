import { plannerSharesChatProvider } from "../context/policy";
import {
	CONNECTOR_ROLES,
	type ConnectorRole,
	type Settings,
} from "../settings/settings";
import { connectorAccess } from "./access";
import type { ClineConnections } from "./cline-connections";
import type { ReadScope, Route } from "./connector";
import { GITHUB_SCOPES } from "./github/github";

/**
 * "Connected to Next Turn": one
 * row per connection the person already has in Cline, grouped by where it
 * comes from. Next Turn never sets one up; an undetected connector is listed
 * greyed with where to set it up in Cline.
 */

export type RoleOption = {
	role: ConnectorRole;
	enabled: boolean;
	reason?: string;
};

export type ConnectorRow = {
	id: string;
	group: "GitHub" | "Composio" | "MCP servers" | "Chat channels";
	label: string;
	detected: boolean;
	/** "gh, signed in · Composio, through your Cline account", or how to set it up. */
	status: string;
	role: ConnectorRole;
	roles: RoleOption[];
	scopes: Array<ReadScope & { checked: boolean; cadence: string }>;
	/** Shown under the role control whenever Read is possible. */
	providerNote?: string;
};

export function cadenceLabel(scope: ReadScope): string {
	const every = `every ${scope.everyMinutes} min`;
	return scope.onPush ? `on push · ${every}` : every;
}

export const PROVIDER_NOTE =
	"Facts go to the same model as your chat. Choosing another model for suggestions turns Read off.";
const NOTIFY_TODAY =
	"Needs-you notifications reach the menubar today; sending to this channel needs upstream ask U5";

function roleOptions(
	routes: readonly Route[],
	detected: boolean,
	readBlockedByProvider: boolean,
	notify: RoleOption,
): RoleOption[] {
	const readRoute = routes.some((route) => route.read === true);
	const readReason = routes
		.map((route) => route.read)
		.find((read): read is { reason: string } => read !== true)?.reason;
	return CONNECTOR_ROLES.map((role): RoleOption => {
		if (role === "off") return { role, enabled: true };
		if (!detected)
			return { role, enabled: false, reason: "Not connected in Cline" };
		if (role === "mention")
			return { role, enabled: routes.some((route) => route.mention) };
		if (role === "read") {
			if (!readRoute)
				return {
					role,
					enabled: false,
					reason: readReason ?? "No connection here can read",
				};
			if (readBlockedByProvider)
				return { role, enabled: false, reason: PROVIDER_NOTE };
			return { role, enabled: true };
		}
		return notify;
	});
}

export type RowsInput = {
	settings: Settings;
	chatProviderId?: string;
	githubRoutes: readonly Route[];
	connections: ClineConnections;
	/** Why Cline's Composio tools cannot run here, or nothing when they can. */
	composioReadReason?: string;
	/** A pinned-read connector's runnable pins, as Read scopes. */
	pins?: (connectorId: string) => readonly ReadScope[];
};

const NO_PINS = "Pin a read-only tool, with its arguments, to read through it";

function pinnedRoute(
	id: string,
	label: string,
	readReason: string | undefined,
	pins: readonly ReadScope[],
): Route {
	const reason = readReason ?? (pins.length === 0 ? NO_PINS : undefined);
	return { id, label, mention: true, read: reason ? { reason } : true };
}

export function connectorRows({
	settings,
	chatProviderId,
	githubRoutes,
	connections,
	composioReadReason,
	pins = () => [],
}: RowsInput): ConnectorRow[] {
	const readBlockedByProvider = !plannerSharesChatProvider(
		settings,
		chatProviderId,
	);
	const rows: ConnectorRow[] = [];
	const githubDetected = githubRoutes.length > 0;
	const github = connectorAccess(
		settings,
		"github",
		githubDetected,
		chatProviderId,
	);
	rows.push({
		id: "github",
		group: "GitHub",
		label: "GitHub",
		detected: githubDetected,
		status: githubDetected
			? githubRoutes.map((route) => route.label).join(" · ")
			: "Not connected in Cline. Sign in with `gh auth login`, or connect GitHub under Cline's connectors or MCP servers.",
		role: github.role,
		roles: roleOptions(githubRoutes, githubDetected, readBlockedByProvider, {
			role: "notify",
			enabled: false,
			reason: "GitHub has no Needs-you destination",
		}),
		scopes: GITHUB_SCOPES.map((scope) => ({
			...scope,
			checked: github.scopes.includes(scope.id),
			cadence: cadenceLabel(scope),
		})),
		providerNote: githubRoutes.some((route) => route.read === true)
			? PROVIDER_NOTE
			: undefined,
	});
	for (const toolkit of connections.composio) {
		if (toolkit.toolkit === "github") continue;
		const id = `composio:${toolkit.toolkit}`;
		const access = connectorAccess(
			settings,
			id,
			toolkit.connected,
			chatProviderId,
		);
		const scopes = pins(id);
		const routes = toolkit.connected
			? [
					pinnedRoute(
						"composio",
						"Composio, through your Cline account",
						composioReadReason,
						scopes,
					),
				]
			: [];
		rows.push({
			id,
			group: "Composio",
			label: toolkit.toolkit,
			detected: toolkit.connected,
			status: toolkit.connected
				? "Connected through your Cline account"
				: "Not connected; connect it in Cline's connectors",
			role: access.role,
			roles: roleOptions(routes, toolkit.connected, readBlockedByProvider, {
				role: "notify",
				enabled: false,
				reason: "Composio toolkits have no Needs-you destination",
			}),
			scopes: scopes.map((scope) => ({
				...scope,
				checked: access.scopes.includes(scope.id),
				cadence: cadenceLabel(scope),
			})),
			providerNote: routes.some((route) => route.read === true)
				? PROVIDER_NOTE
				: undefined,
		});
	}
	for (const server of connections.mcp) {
		const id = `mcp:${server.name}`;
		const detected = !server.disabled;
		const access = connectorAccess(settings, id, detected, chatProviderId);
		const scopes = pins(id);
		const how =
			server.transport === "stdio"
				? "stdio; each read starts the server"
				: "HTTP";
		const routes = detected
			? [
					pinnedRoute(
						id,
						`MCP server "${server.name}" (${how})`,
						undefined,
						scopes,
					),
				]
			: [];
		rows.push({
			id,
			group: "MCP servers",
			label: server.name,
			detected,
			status: detected
				? `In Cline's MCP settings · ${how}`
				: "Disabled in Cline's MCP settings",
			role: access.role,
			roles: roleOptions(routes, detected, readBlockedByProvider, {
				role: "notify",
				enabled: false,
				reason: "MCP servers have no Needs-you destination",
			}),
			scopes: scopes.map((scope) => ({
				...scope,
				checked: access.scopes.includes(scope.id),
				cadence: cadenceLabel(scope),
			})),
			providerNote: routes.some((route) => route.read === true)
				? PROVIDER_NOTE
				: undefined,
		});
	}
	rows.push({
		id: "menubar",
		group: "Chat channels",
		label: "This Mac's notifications",
		detected: true,
		status: "The menubar app: Needs-you items and failed or blocked work",
		role: settings.notify.needsYou ? "notify" : "off",
		roles: CONNECTOR_ROLES.map((role) =>
			role === "off" || role === "notify"
				? { role, enabled: true }
				: {
						role,
						enabled: false,
						reason: "Notifications are a destination, not a source",
					},
		),
		scopes: [],
	});
	for (const channel of connections.channels) {
		const id = `channel:${channel}`;
		rows.push({
			id,
			group: "Chat channels",
			label: channel,
			detected: true,
			status: "Configured with `cline connect`",
			role: "off",
			roles: CONNECTOR_ROLES.map((role) =>
				role === "off"
					? { role, enabled: true }
					: {
							role,
							enabled: false,
							reason:
								role === "notify"
									? NOTIFY_TODAY
									: "Channels are destinations, not sources",
						},
			),
			scopes: [],
		});
	}
	return rows;
}
