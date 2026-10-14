import type { ContextSource, SourceEnv } from "../context/source";
import type { ConnectorRole } from "../settings/settings";

/**
 * A connector is a source the person gives a role.
 *
 * Next Turn uses the connections the person already gave Cline; it never
 * signs in to anything or stores a credential. A connector therefore lists
 * the **routes** it found (the `gh` sign-in Cline desktop's PR bar uses, a
 * Composio toolkit on the Cline account, an MCP server in Cline's settings)
 * and says, per route, whether it can read.
 */

/** One Cline connection a connector can go through. */
export type Route = {
	id: string;
	/** As the settings page shows it: "gh, signed in", "Composio, through your Cline account". */
	label: string;
	/** False with the reason when this route cannot read here yet. */
	read: true | { reason: string };
};

/** What Read may fetch, each a checkbox in settings, with how often it refreshes and whether a push refreshes it. */
export type ReadScope = {
	id: string;
	label: string;
	everyMinutes: number;
	onPush?: boolean;
};

/** What the person chose for this connector, after the provider rule. */
export type Access = {
	role: ConnectorRole;
	scopes: string[];
	readAllowed: boolean;
};

export function composioConnectorId(toolkit: string): string {
	return `composio:${toolkit}`;
}

export function mcpConnectorId(serverName: string): string {
	return `mcp:${serverName}`;
}

export interface Connector extends ContextSource {
	readonly scopes: readonly ReadScope[];
	/** Background only, never in a hook: read one scope and cache it. */
	refresh(scope: string, env: SourceEnv): Promise<void>;
}
