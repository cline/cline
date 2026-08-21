import type { MarketplaceCatalog, MarketplaceEntry } from "@shared/proto/cline/marketplace"

/**
 * Enterprise remote-config policy fields that govern the MCP marketplace.
 * Mirrors the legacy field names distributed through remote configuration:
 * - `mcpMarketplaceEnabled: false` blocks the MCP marketplace entirely.
 * - `allowedMCPServers` restricts the marketplace to an approved allowlist.
 */
export interface McpMarketplacePolicy {
	mcpMarketplaceEnabled?: boolean
	allowedMCPServers?: Array<{ id: string }>
}

/**
 * Normalizes an identifier for fuzzy comparison: strips URL protocol/www and
 * trailing slashes, lowercases, and collapses non-alphanumerics to dashes so
 * that e.g. "https://github.com/Example/Contract-MCP/" matches
 * "github.com/example/contract-mcp".
 */
function normalizePolicyValue(value: string | undefined): string {
	return (value ?? "")
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/\/+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

/**
 * The identifiers a marketplace MCP entry can be matched against. Enterprise
 * allowlists have historically used GitHub repo URLs as ids, while the current
 * documentation tells admins to use the configured server name, so we accept
 * the entry id, display name, installed server name (first install arg), and
 * the entry's source/homepage URLs.
 */
function entryPolicyCandidates(entry: MarketplaceEntry): Set<string> {
	const candidates = new Set(
		[entry.id, entry.name, entry.install?.args?.[0], entry.sourceUrl, entry.homepageUrl].map(normalizePolicyValue),
	)
	candidates.delete("")
	return candidates
}

/**
 * Returns true when the marketplace entry is allowed under the organization's
 * MCP policy. Non-MCP entries (skills, plugins) are not governed by MCP
 * controls and are always allowed.
 */
export function isMarketplaceEntryAllowedByPolicy(entry: MarketplaceEntry, policy: McpMarketplacePolicy): boolean {
	if (entry.type !== "mcp") {
		return true
	}
	if (policy.mcpMarketplaceEnabled === false) {
		return false
	}
	const allowlist = policy.allowedMCPServers
	if (!allowlist || allowlist.length === 0) {
		return true
	}
	const candidates = entryPolicyCandidates(entry)
	return allowlist.some((server) => candidates.has(normalizePolicyValue(server.id)))
}

/**
 * Filters MCP entries out of a marketplace catalog according to the
 * organization's remote-config MCP policy.
 */
export function filterMarketplaceCatalogByPolicy(catalog: MarketplaceCatalog, policy: McpMarketplacePolicy): MarketplaceCatalog {
	if (policy.mcpMarketplaceEnabled !== false && (!policy.allowedMCPServers || policy.allowedMCPServers.length === 0)) {
		return catalog
	}
	return {
		...catalog,
		entries: catalog.entries.filter((entry) => isMarketplaceEntryAllowedByPolicy(entry, policy)),
	}
}
