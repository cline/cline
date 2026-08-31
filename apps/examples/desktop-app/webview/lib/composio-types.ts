/**
 * Shared shapes for the Composio connectors feature (Gmail, Google Calendar,
 * GitHub, and the wider Composio toolkit catalog). Imported by both the
 * webview and the sidecar, mirroring `cline-integrations-types.ts`.
 */

/** A Composio toolkit slug, e.g. "gmail", "googlecalendar", "github". */
export type ComposioToolkitSlug = string;

const TOOLKIT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isComposioToolkitSlug(
	value: unknown,
): value is ComposioToolkitSlug {
	return typeof value === "string" && TOOLKIT_SLUG_PATTERN.test(value);
}

export type ComposioIntegrationStatus =
	| "not_connected"
	/** Auth flow started; waiting for the browser OAuth flow to finish. */
	| "pending"
	| "connected";

export type ComposioIntegrationSummary = {
	toolkit: ComposioToolkitSlug;
	name: string;
	description: string;
	/** Logo URL from the Composio catalog, when known. */
	logo?: string;
	/** True for the curated toolkits pinned at the top of the Connectors UI. */
	recommended: boolean;
	status: ComposioIntegrationStatus;
	connectedAccountId?: string;
	connectedAt?: string;
	toolNames?: string[];
	/** Why the most recent connection attempt failed, if it did. */
	error?: string;
};

export type ComposioStatusResponse = {
	/** True once a Composio API key is available. */
	configured: boolean;
	/**
	 * Where the active key came from: entered in Settings ("user") or the
	 * sidecar's COMPOSIO_API_KEY environment variable ("environment").
	 * Absent when unconfigured.
	 */
	keySource?: "user" | "environment";
	/**
	 * The recommended toolkits (always present) plus any other toolkit that
	 * is currently connected or mid-connection.
	 */
	integrations: ComposioIntegrationSummary[];
};

export type ComposioConnectResponse = {
	/** OAuth URL the user finishes in the external browser. Empty when the
	 * toolkit turned out to already be connected. */
	redirectUrl?: string;
	alreadyConnected?: boolean;
	status: ComposioStatusResponse;
};

/** One entry in the browsable Composio toolkit catalog. */
export type ComposioCatalogToolkit = {
	slug: ComposioToolkitSlug;
	name: string;
	description?: string;
	logo?: string;
	categories?: string[];
	toolsCount?: number;
	recommended: boolean;
};

export type ComposioCatalogResponse = {
	/** True once a Composio API key is available. */
	configured: boolean;
	/** Usage-ranked toolkit catalog; empty until a key is configured. */
	toolkits: ComposioCatalogToolkit[];
};

export type ComposioRecommendedToolkit = {
	slug: ComposioToolkitSlug;
	name: string;
	description: string;
};

/** The connectors pinned as "Recommended". Order controls display order. */
export const COMPOSIO_RECOMMENDED_TOOLKITS: ComposioRecommendedToolkit[] = [
	{
		slug: "gmail",
		name: "Gmail",
		description: "Read, search, draft, and send email from your Gmail account.",
	},
	{
		slug: "googlecalendar",
		name: "Google Calendar",
		description: "List, create, and update events on your Google Calendar.",
	},
	{
		slug: "github",
		name: "GitHub",
		description: "Work with issues, pull requests, and repositories on GitHub.",
	},
];

export function findRecommendedToolkit(
	slug: string,
): ComposioRecommendedToolkit | undefined {
	return COMPOSIO_RECOMMENDED_TOOLKITS.find((entry) => entry.slug === slug);
}

/** Where users create a Composio API key. */
export const COMPOSIO_DASHBOARD_URL = "https://platform.composio.dev";
