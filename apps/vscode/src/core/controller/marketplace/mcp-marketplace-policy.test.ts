import { describe, expect, it } from "bun:test"
import { MarketplaceCatalog, MarketplaceEntry } from "@shared/proto/cline/marketplace"
import { filterMarketplaceCatalogByPolicy, isMarketplaceEntryAllowedByPolicy } from "./mcp-marketplace-policy"

function mcpEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
	return MarketplaceEntry.create({
		id: "airtable",
		type: "mcp",
		name: "Airtable",
		install: { args: ["airtable", "--transport", "http", "https://mcp.airtable.com/mcp"], env: [] },
		sourceUrl: "https://github.com/Airtable/airtable-mcp-cli",
		...overrides,
	})
}

function skillEntry(): MarketplaceEntry {
	return MarketplaceEntry.create({ id: "pdf-tools", type: "skill", name: "PDF Tools" })
}

describe("isMarketplaceEntryAllowedByPolicy", () => {
	it("allows everything when no policy fields are set", () => {
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), {})).toBe(true)
		expect(isMarketplaceEntryAllowedByPolicy(skillEntry(), {})).toBe(true)
	})

	it("blocks MCP entries when the marketplace is disabled", () => {
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), { mcpMarketplaceEnabled: false })).toBe(false)
	})

	it("does not block non-MCP entries when the MCP marketplace is disabled", () => {
		expect(isMarketplaceEntryAllowedByPolicy(skillEntry(), { mcpMarketplaceEnabled: false })).toBe(true)
	})

	it("allows MCP entries when the marketplace is explicitly enabled and no allowlist exists", () => {
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), { mcpMarketplaceEnabled: true })).toBe(true)
	})

	it("matches allowlist ids against the entry id", () => {
		const policy = { allowedMCPServers: [{ id: "airtable" }] }
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), policy)).toBe(true)
	})

	it("matches allowlist ids against the installed server name", () => {
		const policy = { allowedMCPServers: [{ id: "custom-server-name" }] }
		const entry = mcpEntry({
			id: "some-catalog-id",
			name: "Some Catalog Name",
			install: { args: ["custom-server-name", "--", "npx", "-y", "some-pkg"], env: [] },
		})
		expect(isMarketplaceEntryAllowedByPolicy(entry, policy)).toBe(true)
	})

	it("matches allowlist ids against the display name case-insensitively", () => {
		const policy = { allowedMCPServers: [{ id: "AIRTABLE" }] }
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), policy)).toBe(true)
	})

	it("matches legacy GitHub-URL allowlist ids against the source URL", () => {
		expect(
			isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				allowedMCPServers: [{ id: "https://github.com/Airtable/airtable-mcp-cli" }],
			}),
		).toBe(true)
		expect(
			isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				allowedMCPServers: [{ id: "github.com/airtable/airtable-mcp-cli/" }],
			}),
		).toBe(true)
	})

	it("blocks MCP entries that do not match any allowlist id", () => {
		const policy = { allowedMCPServers: [{ id: "filesystem" }, { id: "github.com/example/other" }] }
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), policy)).toBe(false)
	})

	it("blocks MCP entries when the marketplace is disabled even if allowlisted", () => {
		const policy = { mcpMarketplaceEnabled: false, allowedMCPServers: [{ id: "airtable" }] }
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), policy)).toBe(false)
	})

	it("treats an empty allowlist as no restriction, matching local-server enforcement", () => {
		expect(isMarketplaceEntryAllowedByPolicy(mcpEntry(), { allowedMCPServers: [] })).toBe(true)
	})

	it("never blocks skills or plugins via the allowlist", () => {
		const policy = { allowedMCPServers: [{ id: "filesystem" }] }
		expect(isMarketplaceEntryAllowedByPolicy(skillEntry(), policy)).toBe(true)
	})
})

describe("filterMarketplaceCatalogByPolicy", () => {
	const catalog = MarketplaceCatalog.create({
		entries: [
			mcpEntry(),
			mcpEntry({ id: "filesystem", name: "Filesystem", install: { args: ["filesystem"], env: [] }, sourceUrl: "" }),
			skillEntry(),
		],
	})

	it("returns the catalog unchanged when no policy applies", () => {
		expect(filterMarketplaceCatalogByPolicy(catalog, {}).entries).toHaveLength(3)
		expect(filterMarketplaceCatalogByPolicy(catalog, { mcpMarketplaceEnabled: true }).entries).toHaveLength(3)
		expect(filterMarketplaceCatalogByPolicy(catalog, { allowedMCPServers: [] }).entries).toHaveLength(3)
	})

	it("removes all MCP entries when the marketplace is disabled", () => {
		const filtered = filterMarketplaceCatalogByPolicy(catalog, { mcpMarketplaceEnabled: false })
		expect(filtered.entries.map((entry) => entry.id)).toEqual(["pdf-tools"])
	})

	it("keeps only allowlisted MCP entries plus non-MCP entries", () => {
		const filtered = filterMarketplaceCatalogByPolicy(catalog, { allowedMCPServers: [{ id: "filesystem" }] })
		expect(filtered.entries.map((entry) => entry.id)).toEqual(["filesystem", "pdf-tools"])
	})
})
