import { afterEach, describe, it, mock } from "bun:test"
import * as assert from "assert"
import { MarketplaceCatalog, MarketplaceEntry } from "@shared/proto/cline/marketplace"
import sinon from "sinon"
import type { Controller } from "../../index"

const fetchMarketplaceCatalogStub: sinon.SinonStub = sinon.stub()
// Keep this factory shape in sync with installMarketplaceEntry.test.ts: bun's
// mock.module registry is shared across test files, so each factory must
// provide every export the other mocked consumers import.
const installMarketplaceEntryFromCatalogStub: sinon.SinonStub = sinon.stub()
const marketplaceHelpersMock = () => ({
	fetchMarketplaceCatalog: fetchMarketplaceCatalogStub,
	installMarketplaceEntryFromCatalog: installMarketplaceEntryFromCatalogStub,
})

mock.module("../marketplace-helpers", marketplaceHelpersMock)
mock.module("./marketplace-helpers", marketplaceHelpersMock)

function makeController(remoteConfig: Record<string, unknown>) {
	const waitForInitialRemoteConfig = sinon.stub().resolves()
	const controller = {
		waitForInitialRemoteConfig,
		stateManager: { getRemoteConfigSettings: () => remoteConfig },
	} as unknown as Controller
	return { controller, waitForInitialRemoteConfig }
}

function makeCatalog(): MarketplaceCatalog {
	return MarketplaceCatalog.create({
		entries: [
			MarketplaceEntry.create({
				id: "chrome-devtools",
				type: "mcp",
				name: "Chrome DevTools",
				sourceUrl: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
			}),
			MarketplaceEntry.create({
				id: "airtable",
				type: "mcp",
				name: "Airtable",
				sourceUrl: "https://github.com/example/airtable-mcp",
			}),
			MarketplaceEntry.create({ id: "pdf-tools", type: "skill", name: "PDF Tools" }),
		],
	})
}

describe("getMarketplaceCatalog", () => {
	afterEach(() => {
		fetchMarketplaceCatalogStub.reset()
	})

	it("waits for the initial remote config before serving the catalog", async () => {
		const { getMarketplaceCatalog } = await import("../getMarketplaceCatalog")
		fetchMarketplaceCatalogStub.resolves(makeCatalog())
		const { controller, waitForInitialRemoteConfig } = makeController({})

		await getMarketplaceCatalog(controller, {})

		assert.equal(waitForInitialRemoteConfig.callCount, 1)
	})

	it("returns the full catalog when no enterprise policy is configured", async () => {
		const { getMarketplaceCatalog } = await import("../getMarketplaceCatalog")
		fetchMarketplaceCatalogStub.resolves(makeCatalog())
		const { controller } = makeController({})

		const catalog = await getMarketplaceCatalog(controller, {})

		assert.deepEqual(
			catalog.entries.map((entry) => entry.id),
			["chrome-devtools", "airtable", "pdf-tools"],
		)
	})

	it("removes all MCP entries when the enterprise config disables the MCP marketplace", async () => {
		const { getMarketplaceCatalog } = await import("../getMarketplaceCatalog")
		fetchMarketplaceCatalogStub.resolves(makeCatalog())
		const { controller } = makeController({ mcpMarketplaceEnabled: false })

		const catalog = await getMarketplaceCatalog(controller, {})

		assert.deepEqual(
			catalog.entries.map((entry) => entry.id),
			["pdf-tools"],
		)
	})

	it("filters MCP entries down to the enterprise allowlist", async () => {
		const { getMarketplaceCatalog } = await import("../getMarketplaceCatalog")
		fetchMarketplaceCatalogStub.resolves(makeCatalog())
		const { controller } = makeController({
			allowedMCPServers: [{ id: "github.com/ChromeDevTools/chrome-devtools-mcp" }],
		})

		const catalog = await getMarketplaceCatalog(controller, {})

		assert.deepEqual(
			catalog.entries.map((entry) => entry.id),
			["chrome-devtools", "pdf-tools"],
		)
	})
})
