import type { MarketplaceEntry } from "@shared/proto/cline/marketplace"
import type { RemoteConfigFields } from "@shared/storage/state-keys"

/**
 * The subset of enterprise remote config that governs MCP marketplace access.
 * - `mcpMarketplaceEnabled === false` hides the MCP marketplace entirely.
 * - `allowedMCPServers` (when configured) restricts the catalog to the allowlist;
 *   an empty array means no MCP servers are available.
 */
export type McpMarketplacePolicy = Pick<Partial<RemoteConfigFields>, "mcpMarketplaceEnabled" | "allowedMCPServers">

/**
 * Normalizes enterprise allowlist ids and catalog entry identifiers so the
 * historical id formats all match each other:
 * - marketplace slugs ("chrome-devtools")
 * - GitHub repo paths ("github.com/org/repo", the format used in enterprise docs)
 * - full repo URLs ("https://github.com/org/repo")
 */
function normalizeMcpPolicyId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "")
}

function mcpEntryIdCandidates(entry: MarketplaceEntry): string[] {
	const candidates = [entry.id, entry.name, entry.install?.args?.[0], entry.sourceUrl]
	return candidates
		.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "")
		.map(normalizeMcpPolicyId)
}

/**
 * Whether an entry may be surfaced/installed under the organization's MCP
 * marketplace policy. Non-MCP entries (skills, plugins) are never restricted here.
 */
export function isMarketplaceEntryAllowedByPolicy(entry: MarketplaceEntry, policy: McpMarketplacePolicy): boolean {
	if (entry.type !== "mcp") {
		return true
	}
	if (policy.mcpMarketplaceEnabled === false) {
		return false
	}
	const allowlist = policy.allowedMCPServers
	if (allowlist === undefined) {
		return true
	}
	const allowedIds = new Set(allowlist.map((server) => normalizeMcpPolicyId(server.id)))
	return mcpEntryIdCandidates(entry).some((candidate) => allowedIds.has(candidate))
}

/**
 * Filters marketplace catalog entries down to the ones permitted by the
 * organization's MCP marketplace policy.
 */
export function filterMarketplaceEntriesByPolicy(entries: MarketplaceEntry[], policy: McpMarketplacePolicy): MarketplaceEntry[] {
	if (policy.mcpMarketplaceEnabled !== false && policy.allowedMCPServers === undefined) {
		return entries
	}
	return entries.filter((entry) => isMarketplaceEntryAllowedByPolicy(entry, policy))
}
