import type { ContextSource, Facts, SourceEnv } from "../context/source";
import type { ConnectorRole } from "../settings/settings";

/**
 * A connector is a source the person gives a role.
 *
 * Next Turn uses the connections the person already gave Cline; it never
 * signs in to anything or stores a credential. A connector therefore lists
 * the **routes** it found (the `gh` sign-in Cline desktop's PR bar uses, a
 * Composio toolkit on the Cline account, an MCP server in Cline's settings)
 * and says, per route, which roles each one can carry.
 */

export type ConnectorKind = "github" | "composio" | "mcp" | "channel";

/** One Cline connection a connector can go through. */
export type Route = {
	id: string;
	/** As the settings page shows it: "gh, signed in", "Composio, through your Cline account". */
	label: string;
	mention: boolean;
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

export type Detection = { routes: Route[]; detectedAt: number };

/** What the person chose for this connector, after the provider rule. */
export type Access = {
	role: ConnectorRole;
	scopes: string[];
	readAllowed: boolean;
};

export interface Connector extends ContextSource {
	readonly kind: ConnectorKind;
	readonly scopes: readonly ReadScope[];
	/** Which Cline connections exist here; cheap, cached. */
	detect(env: SourceEnv): Promise<Detection>;
	/** Background only, never in a hook: read one scope and cache it. */
	refresh?(scope: string, env: SourceEnv): Promise<void>;
	/** The facts block the planner would receive right now, for "Preview what this adds". */
	preview?(env: SourceEnv): Facts | "unknown";
}

/** Roles a connector can take here: Mention if any route mentions, Read if any route reads; Notify is per connector. */
export function supportedRoles(detection: Detection): {
	mention: boolean;
	read: boolean;
} {
	return {
		mention: detection.routes.some((route) => route.mention),
		read: detection.routes.some((route) => route.read === true),
	};
}
