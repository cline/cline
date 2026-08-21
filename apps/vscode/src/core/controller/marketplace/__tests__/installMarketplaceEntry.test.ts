import { afterEach, describe, it, mock } from "bun:test"
import * as assert from "assert"
import sinon from "sinon"
import type { Controller } from "../../index"

const installMarketplaceEntryFromCatalogStub: sinon.SinonStub = sinon.stub()
// Keep this factory shape in sync with getMarketplaceCatalog.test.ts: bun's
// mock.module registry is shared across test files, so each factory must
// provide every export the other mocked consumers import.
const fetchMarketplaceCatalogStub: sinon.SinonStub = sinon.stub()
const marketplaceHelpersMock = () => ({
	installMarketplaceEntryFromCatalog: installMarketplaceEntryFromCatalogStub,
	fetchMarketplaceCatalog: fetchMarketplaceCatalogStub,
})

mock.module("../marketplace-helpers", marketplaceHelpersMock)
mock.module("./marketplace-helpers", marketplaceHelpersMock)

function makeController(remoteConfig: Record<string, unknown> = {}) {
	const reconcileMcpServersFromSettingsRPC = sinon.stub().resolves([])
	const invalidateUserInstructionService = sinon.stub().resolves()
	const controller = {
		mcpHub: { reconcileMcpServersFromSettingsRPC },
		invalidateUserInstructionService,
		stateManager: { getRemoteConfigSettings: () => remoteConfig },
	} as unknown as Controller
	return { controller, reconcileMcpServersFromSettingsRPC, invalidateUserInstructionService }
}

const chromeDevtoolsEntry = {
	id: "chrome-devtools",
	type: "mcp",
	name: "Chrome DevTools",
	install: {
		args: ["chrome-devtools", "--", "npx", "chrome-devtools-mcp@1.2.0"],
		env: [],
	},
	tags: [],
	tagObjects: [],
}

describe("installMarketplaceEntry", () => {
	afterEach(() => {
		installMarketplaceEntryFromCatalogStub.reset()
	})

	it("reconciles the MCP hub after installing an MCP marketplace entry", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller, reconcileMcpServersFromSettingsRPC, invalidateUserInstructionService } = makeController()
		installMarketplaceEntryFromCatalogStub.resolves({
			id: "chrome-devtools",
			type: "mcp",
			status: "installed",
		})

		await installMarketplaceEntry(controller, { entry: chromeDevtoolsEntry })

		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 1)
		assert.equal(reconcileMcpServersFromSettingsRPC.callCount, 1)
		assert.equal(invalidateUserInstructionService.callCount, 0)
	})

	it("rejects MCP installs that the enterprise policy does not allow", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller, reconcileMcpServersFromSettingsRPC } = makeController({
			allowedMCPServers: [{ id: "github.com/example/approved-server" }],
		})

		await assert.rejects(
			() => installMarketplaceEntry(controller, { entry: chromeDevtoolsEntry }),
			/not allowed by your organization/,
		)
		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 0)
		assert.equal(reconcileMcpServersFromSettingsRPC.callCount, 0)
	})

	it("rejects MCP installs when the enterprise policy disables the MCP marketplace", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller } = makeController({ mcpMarketplaceEnabled: false })

		await assert.rejects(
			() => installMarketplaceEntry(controller, { entry: chromeDevtoolsEntry }),
			/not allowed by your organization/,
		)
		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 0)
	})
})
