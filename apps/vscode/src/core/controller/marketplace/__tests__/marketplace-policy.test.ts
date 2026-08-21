import { describe, expect, it } from "bun:test"
import { MarketplaceEntry } from "@shared/proto/cline/marketplace"
import { filterMarketplaceEntriesByPolicy, isMarketplaceEntryAllowedByPolicy } from "../marketplace-policy"

function mcpEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
	return MarketplaceEntry.create({
		id: "chrome-devtools",
		type: "mcp",
		name: "Chrome DevTools",
		sourceUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
		install: { args: ["chrome-devtools", "--", "npx", "chrome-devtools-mcp@latest"], env: [] },
		...overrides,
	})
}

function skillEntry(): MarketplaceEntry {
	return MarketplaceEntry.create({ id: "pdf-tools", type: "skill", name: "PDF Tools" })
}

describe("marketplace-policy", () => {
	describe("no enterprise policy", () => {
		it("allows every entry when remote config is empty", () => {
			const entries = [mcpEntry(), skillEntry()]
			expect(filterMarketplaceEntriesByPolicy(entries, {})).toEqual(entries)
		})

		it("allows every entry when mcpMarketplaceEnabled is true and no allowlist is set", () => {
			const entries = [mcpEntry(), skillEntry()]
			expect(filterMarketplaceEntriesByPolicy(entries, { mcpMarketplaceEnabled: true })).toEqual(entries)
		})
	})

	describe("mcpMarketplaceEnabled: false", () => {
		it("removes all MCP entries but keeps other entry types", () => {
			const skill = skillEntry()
			const filtered = filterMarketplaceEntriesByPolicy([mcpEntry(), skill], { mcpMarketplaceEnabled: false })
			expect(filtered).toEqual([skill])
		})

		it("blocks MCP entries even when they are on the allowlist", () => {
			const allowed = isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				mcpMarketplaceEnabled: false,
				allowedMCPServers: [{ id: "chrome-devtools" }],
			})
			expect(allowed).toBe(false)
		})
	})

	describe("allowedMCPServers allowlist", () => {
		it("keeps only allowlisted MCP entries", () => {
			const chrome = mcpEntry()
			const other = mcpEntry({
				id: "airtable",
				name: "Airtable",
				sourceUrl: "https://github.com/example/airtable-mcp",
				install: { args: ["airtable", "--", "npx", "airtable-mcp@latest"], env: [] },
			})
			const filtered = filterMarketplaceEntriesByPolicy([chrome, other], {
				allowedMCPServers: [{ id: "chrome-devtools" }],
			})
			expect(filtered).toEqual([chrome])
		})

		it("shows no MCP entries when the allowlist is empty", () => {
			const skill = skillEntry()
			const filtered = filterMarketplaceEntriesByPolicy([mcpEntry(), skill], { allowedMCPServers: [] })
			expect(filtered).toEqual([skill])
		})

		it("does not restrict skills or plugins", () => {
			expect(isMarketplaceEntryAllowedByPolicy(skillEntry(), { allowedMCPServers: [] })).toBe(true)
		})

		it("matches GitHub repository paths without a protocol (documented enterprise id format)", () => {
			const allowed = isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				allowedMCPServers: [{ id: "github.com/ChromeDevTools/chrome-devtools-mcp" }],
			})
			expect(allowed).toBe(true)
		})

		it("matches full repository URLs", () => {
			const allowed = isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				allowedMCPServers: [{ id: "https://github.com/chromedevtools/chrome-devtools-mcp" }],
			})
			expect(allowed).toBe(true)
		})

		it("matches the installed MCP server name (first install arg)", () => {
			const entry = mcpEntry({ id: "some-catalog-slug", name: "Renamed", sourceUrl: "" })
			const allowed = isMarketplaceEntryAllowedByPolicy(entry, {
				allowedMCPServers: [{ id: "chrome-devtools" }],
			})
			expect(allowed).toBe(true)
		})

		it("rejects MCP entries with no matching identifier", () => {
			const allowed = isMarketplaceEntryAllowedByPolicy(mcpEntry(), {
				allowedMCPServers: [{ id: "github.com/example/other-server" }],
			})
			expect(allowed).toBe(false)
		})
	})
})
