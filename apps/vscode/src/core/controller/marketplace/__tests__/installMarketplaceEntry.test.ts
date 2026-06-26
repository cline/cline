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

	it("reconciles the MCP hub after installing an MCP marketplace entry", async () => {
		const { installMarketplaceEntry } = await import("../installMarketplaceEntry")
		const reconcileMcpServersFromSettingsRPC = sinon.stub().resolves([])
		const invalidateUserInstructionService = sinon.stub().resolves()
		const controller = {
			mcpHub: { reconcileMcpServersFromSettingsRPC },
			invalidateUserInstructionService,
		} as unknown as Controller
		installMarketplaceEntryFromCatalogStub.resolves({
			id: "chrome-devtools",
			type: "mcp",
			status: "installed",
		})

		await installMarketplaceEntry(controller, {
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
		})

		assert.equal(installMarketplaceEntryFromCatalogStub.callCount, 1)
		assert.equal(reconcileMcpServersFromSettingsRPC.callCount, 1)
		assert.equal(invalidateUserInstructionService.callCount, 0)
	})
})
