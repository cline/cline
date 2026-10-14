import { plannerSharesChatProvider } from "../context/policy";
import {
	CONNECTOR_ROLES,
	type ConnectorRole,
	type Settings,
} from "../settings/settings";
import { connectorAccess } from "./access";
import type { ClineConnections } from "./cline-connections";
import { COMPOSIO_ROUTE, GITHUB_TOOLKIT } from "./composio";
import {
	composioConnectorId,
	mcpConnectorId,
	type ReadScope,
	type Route,
} from "./connector";
import { GITHUB_SCOPES } from "./github/github";
import { mcpRoute } from "./mcp";

/**
 * "Connected to Next Turn": one row per connection the person already has in
 * Cline, grouped by where it comes from. Next Turn never sets one up; an
 * undetected connector is listed greyed with where to set it up in Cline.
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

export type RowsInput = {
	settings: Settings;
	chatProviderId?: string;
	githubRoutes: readonly Route[];
	connections: ClineConnections;
	/** A pinned-read connector's runnable pins, as Read scopes. */
	pins: (connectorId: string) => readonly ReadScope[];
};

function cadenceLabel(scope: ReadScope): string {
	const every = `every ${scope.everyMinutes} min`;
	return scope.onPush ? `on push · ${every}` : every;
}

const PROVIDER_NOTE =
	"Facts go to the same model as your chat. Choosing another model for suggestions turns Read off.";
const NOTIFY_TODAY =
	"Needs-you notifications reach the menubar today; this channel cannot receive them yet";
const NO_PINS = "Pin a read-only tool, with its arguments, to read through it";

/** A source's roles: none but Off until Cline has a route, and Read only through a route that can read. */
function roleOptions(
	routes: readonly Route[],
	readBlockedByProvider: boolean,
	noNotifyReason: string,
): RoleOption[] {
	const readReason = routes
		.map((route) => route.read)
		.find((read): read is { reason: string } => read !== true)?.reason;
	return CONNECTOR_ROLES.map((role): RoleOption => {
		if (role === "off") return { role, enabled: true };
		if (routes.length === 0)
			return { role, enabled: false, reason: "Not connected in Cline" };
		if (role === "mention") return { role, enabled: true };
		if (role === "notify")
			return { role, enabled: false, reason: noNotifyReason };
		if (!routes.some((route) => route.read === true))
			return {
				role,
				enabled: false,
				reason: readReason ?? "No connection here can read",
			};
		if (readBlockedByProvider)
			return { role, enabled: false, reason: PROVIDER_NOTE };
		return { role, enabled: true };
	});
}

/** A destination's roles: the allowed ones, and why each other one is not. */
function destinationRoles(
	allowed: readonly ConnectorRole[],
	reason: (role: ConnectorRole) => string,
): RoleOption[] {
	return CONNECTOR_ROLES.map((role) =>
		allowed.includes(role)
			? { role, enabled: true }
			: { role, enabled: false, reason: reason(role) },
	);
}

function pinnedRoute(
	route: Pick<Route, "id" | "label">,
	pins: readonly ReadScope[],
): Route {
	return { ...route, read: pins.length === 0 ? { reason: NO_PINS } : true };
}

type SourceRow = Pick<ConnectorRow, "id" | "group" | "label" | "status"> & {
	/** Empty when the connector is not connected in Cline. */
	routes: readonly Route[];
	scopes: readonly ReadScope[];
	noNotifyReason: string;
};

export function connectorRows(input: RowsInput): ConnectorRow[] {
	const { settings, chatProviderId, githubRoutes, connections, pins } = input;
	const readBlockedByProvider = !plannerSharesChatProvider(
		settings,
		chatProviderId,
	);
	const sourceRow = ({
		routes,
		scopes,
		noNotifyReason,
		...row
	}: SourceRow): ConnectorRow => {
		const detected = routes.length > 0;
		const access = connectorAccess(settings, row.id, detected, chatProviderId);
		return {
			...row,
			detected,
			role: access.role,
			roles: roleOptions(routes, readBlockedByProvider, noNotifyReason),
			scopes: scopes.map((scope) => ({
				...scope,
				checked: access.scopes.includes(scope.id),
				cadence: cadenceLabel(scope),
			})),
			providerNote: routes.some((route) => route.read === true)
				? PROVIDER_NOTE
				: undefined,
		};
	};
	return [
		sourceRow({
			id: "github",
			group: "GitHub",
			label: "GitHub",
			status:
				githubRoutes.length > 0
					? githubRoutes.map((route) => route.label).join(" · ")
					: "Not connected in Cline. Sign in with `gh auth login`, or connect GitHub under Cline's connectors or MCP servers.",
			routes: githubRoutes,
			scopes: GITHUB_SCOPES,
			noNotifyReason: "GitHub has no Needs-you destination",
		}),
		...connections.composio
			.filter((toolkit) => toolkit.toolkit !== GITHUB_TOOLKIT)
			.map((toolkit) => {
				const id = composioConnectorId(toolkit.toolkit);
				return sourceRow({
					id,
					group: "Composio",
					label: toolkit.toolkit,
					status: toolkit.connected
						? "Connected through your Cline account"
						: "Not connected; connect it in Cline's connectors",
					routes: toolkit.connected ? [COMPOSIO_ROUTE] : [],
					scopes: pins(id),
					noNotifyReason: "Composio toolkits have no Needs-you destination",
				});
			}),
		...connections.mcp.map((server) => {
			const id = mcpConnectorId(server.name);
			const scopes = pins(id);
			const how =
				server.transport === "stdio"
					? "stdio; each read starts the server"
					: "HTTP";
			return sourceRow({
				id,
				group: "MCP servers",
				label: server.name,
				status: server.disabled
					? "Disabled in Cline's MCP settings"
					: `In Cline's MCP settings · ${how}`,
				routes: server.disabled ? [] : [pinnedRoute(mcpRoute(server), scopes)],
				scopes,
				noNotifyReason: "MCP servers have no Needs-you destination",
			});
		}),
		{
			id: "menubar",
			group: "Chat channels",
			label: "This Mac's notifications",
			detected: true,
			status: "The menubar app: Needs-you items and failed or blocked work",
			role: settings.notify.needsYou ? "notify" : "off",
			roles: destinationRoles(
				["off", "notify"],
				() => "Notifications are a destination, not a source",
			),
			scopes: [],
		},
		...connections.channels.map(
			(channel): ConnectorRow => ({
				id: `channel:${channel}`,
				group: "Chat channels",
				label: channel,
				detected: true,
				status: "Configured with `cline connect`",
				role: "off",
				roles: destinationRoles(["off"], (role) =>
					role === "notify"
						? NOTIFY_TODAY
						: "Channels are destinations, not sources",
				),
				scopes: [],
			}),
		),
	];
}
