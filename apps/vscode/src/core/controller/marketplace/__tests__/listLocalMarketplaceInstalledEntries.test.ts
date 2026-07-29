import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { join } from "node:path"
import * as assert from "assert"
import sinon from "sinon"
import type { Controller } from "../../index"

const PLUGIN_ROOT = join("/home/tester", ".cline", "plugins")
const BROKEN_PLUGIN = join(PLUGIN_ROOT, "broken.ts")
const HEALTHY_PLUGIN = join(PLUGIN_ROOT, "healthy.ts")
const DISABLED_PLUGIN = join(PLUGIN_ROOT, "disabled.ts")

const listPluginToolsWithDiagnosticsStub: sinon.SinonStub = sinon.stub()
const readGlobalSettingsStub: sinon.SinonStub = sinon.stub()

mock.module("@cline/core", () => ({
	disablePluginMcpServersInSettings: () => [],
	discoverPluginModulePaths: () => [BROKEN_PLUGIN, HEALTHY_PLUGIN, DISABLED_PLUGIN],
	installMcpServer: async () => ({}),
	installPlugin: async () => ({}),
	isMarketplaceSkillInstalled: () => false,
	listPluginToolsWithDiagnostics: listPluginToolsWithDiagnosticsStub,
	parseMcpInstallArgs: () => ({}),
	readGlobalSettings: readGlobalSettingsStub,
	resolvePluginConfigSearchPaths: () => [PLUGIN_ROOT],
	setDisabledPlugin: () => {},
	syncPluginMcpServersToSettings: async () => ({ failures: [] }),
	uninstallMarketplaceEntry: async () => ({}),
	uninstallPlugin: async () => ({}),
}))

mock.module("node:fs", () => ({
	existsSync: () => true,
	readFileSync: () => "{}",
}))

mock.module("@core/controller/file/refreshSkills", () => ({
	refreshSkills: async () => ({ globalSkills: [], localSkills: [] }),
}))

mock.module("@/hosts/host-provider", () => ({
	HostProvider: {
		isInitialized: () => true,
		workspace: { getWorkspacePaths: async () => ({ paths: ["/workspace/project"] }) },
	},
}))

function makeController(): Controller {
	return {
		mcpHub: { getServers: () => [] },
		stateManager: {
			getGlobalSettingsKey: () => "act",
			getApiConfiguration: () => ({}),
		},
	} as unknown as Controller
}

describe("listLocalMarketplaceInstalledEntries plugin diagnostics", () => {
	beforeEach(() => {
		readGlobalSettingsStub.returns({ disabledPlugins: [DISABLED_PLUGIN] })
		listPluginToolsWithDiagnosticsStub.resolves({
			tools: [],
			warnings: [],
			failures: [{ pluginPath: BROKEN_PLUGIN, phase: "load", message: "plugin-sandbox process exited (code=1)" }],
		})
	})

	afterEach(() => {
		listPluginToolsWithDiagnosticsStub.reset()
		readGlobalSettingsStub.reset()
	})

	it("attaches the load failure to the plugin that could not be loaded", async () => {
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const byPath = new Map(entries.map((entry) => [entry.path, entry]))

		assert.equal(byPath.get(BROKEN_PLUGIN)?.error, "plugin-sandbox process exited (code=1)")
		assert.equal(byPath.get(HEALTHY_PLUGIN)?.error, undefined)
	})

	it("does not report failures against disabled plugins", async () => {
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const disabled = entries.find((entry) => entry.path === DISABLED_PLUGIN)

		assert.equal(disabled?.enabled, false)
		assert.equal(disabled?.error, undefined)
	})

	it("keeps listing plugins when the diagnostics probe throws", async () => {
		listPluginToolsWithDiagnosticsStub.rejects(new Error("probe exploded"))
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())

		assert.equal(entries.filter((entry) => entry.type === "plugin").length, 3)
		assert.equal(
			entries.every((entry) => entry.error === undefined),
			true,
		)
	})

	it("skips the probe entirely when every discovered plugin is disabled", async () => {
		readGlobalSettingsStub.returns({ disabledPlugins: [BROKEN_PLUGIN, HEALTHY_PLUGIN, DISABLED_PLUGIN] })
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		await listLocalMarketplaceInstalledEntries(makeController())

		assert.equal(listPluginToolsWithDiagnosticsStub.callCount, 0)
	})
})
