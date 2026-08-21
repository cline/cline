import { afterEach, describe, it, mock } from "bun:test"
import * as assert from "assert"
import sinon from "sinon"
import type { Controller } from "../../index"

const installMarketplaceEntryFromCatalogStub: sinon.SinonStub = sinon.stub()
const marketplaceHelpersMock = () => ({
	installMarketplaceEntryFromCatalog: installMarketplaceEntryFromCatalogStub,
})

mock.module("../marketplace-helpers", marketplaceHelpersMock)
mock.module("./marketplace-helpers", marketplaceHelpersMock)

describe("installMarketplaceEntry", () => {
	afterEach(() => {
		installMarketplaceEntryFromCatalogStub.reset()
	})

	function makeController(remoteConfigSettings: Record<string, unknown> = {}) {
		const reconcileMcpServersFromSettingsRPC = sinon.stub().resolves([])
		const invalidateUserInstructionService = sinon.stub().resolves()
		const controller = {
			mcpHub: { reconcileMcpServersFromSettingsRPC },
			invalidateUserInstructionService,
			stateManager: { getRemoteConfigSettings: () => remoteConfigSettings },
		} as unknown as Controller
		return { controller, reconcileMcpServersFromSettingsRPC, invalidateUserInstructionService }
	}

	const mcpEntryRequest = {
		entry: {
			id: "chrome-devtools",
			type: "mcp",
			name: "Chrome DevTools",
			install: {
				args: ["chrome-devtools", "--", "npx", "chrome-devtools-mcp@1.2.0"],
				env: [],
			},
			tags: [],
			tagObjects: [],
		},
	}

	it("reconciles the MCP hub after installing an MCP marketplace entry", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller, reconcileMcpServersFromSettingsRPC, invalidateUserInstructionService } = makeController()
		installMarketplaceEntryFromCatalogStub.resolves({
			id: "chrome-devtools",
			type: "mcp",
			status: "installed",
		})

		await installMarketplaceEntry(controller, mcpEntryRequest)

		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 1)
		assert.equal(reconcileMcpServersFromSettingsRPC.callCount, 1)
		assert.equal(invalidateUserInstructionService.callCount, 0)
	})

	it("rejects MCP installs when the enterprise MCP marketplace is disabled", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller } = makeController({ mcpMarketplaceEnabled: false })

		await assert.rejects(installMarketplaceEntry(controller, mcpEntryRequest), /blocked by your organization/)
		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 0)
	})

	it("rejects MCP installs that are not on the enterprise allowlist", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller } = makeController({ allowedMCPServers: [{ id: "filesystem" }] })

		await assert.rejects(installMarketplaceEntry(controller, mcpEntryRequest), /blocked by your organization/)
		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 0)
	})

	it("allows MCP installs that are on the enterprise allowlist", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const { controller, reconcileMcpServersFromSettingsRPC } = makeController({
			allowedMCPServers: [{ id: "chrome-devtools" }],
		})
		installMarketplaceEntryFromCatalogStub.resolves({
			id: "chrome-devtools",
			type: "mcp",
			status: "installed",
		})

		await installMarketplaceEntry(controller, mcpEntryRequest)

		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 1)
		assert.equal(reconcileMcpServersFromSettingsRPC.callCount, 1)
	})
})
