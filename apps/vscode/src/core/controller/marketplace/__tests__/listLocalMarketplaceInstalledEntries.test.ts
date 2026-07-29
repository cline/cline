import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { join } from "node:path"
import * as assert from "assert"
import sinon from "sinon"
import type { Controller } from "../../index"

const PLUGIN_ROOT = join("/home/tester", ".cline", "plugins")
const BROKEN_PLUGIN = join(PLUGIN_ROOT, "broken.ts")
const HEALTHY_PLUGIN = join(PLUGIN_ROOT, "healthy.ts")
const DISABLED_PLUGIN = join(PLUGIN_ROOT, "disabled.ts")

const getLatestPluginLoadReportStub: sinon.SinonStub = sinon.stub()
const readGlobalSettingsStub: sinon.SinonStub = sinon.stub()
const listPluginToolsWithDiagnosticsStub: sinon.SinonStub = sinon.stub()

mock.module("@cline/core", () => ({
	disablePluginMcpServersInSettings: () => [],
	discoverPluginModulePaths: () => [BROKEN_PLUGIN, HEALTHY_PLUGIN, DISABLED_PLUGIN],
	getLatestPluginLoadReport: getLatestPluginLoadReportStub,
	installMcpServer: async () => ({}),
	installPlugin: async () => ({}),
	isMarketplaceSkillInstalled: () => false,
	// Present only so the test can assert the listing path never loads plugins.
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

let workspacePaths: string[] = ["/workspace/project"]

mock.module("@/hosts/host-provider", () => ({
	HostProvider: {
		isInitialized: () => true,
		workspace: { getWorkspacePaths: async () => ({ paths: workspacePaths }) },
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

function report(overrides: Record<string, unknown> = {}) {
	return {
		pluginPaths: [BROKEN_PLUGIN, HEALTHY_PLUGIN],
		failures: [{ pluginPath: BROKEN_PLUGIN, phase: "load", message: "plugin-sandbox process exited (code=1)" }],
		warnings: [],
		recordedAt: Date.now(),
		...overrides,
	}
}

describe("listLocalMarketplaceInstalledEntries plugin diagnostics", () => {
	beforeEach(() => {
		workspacePaths = ["/workspace/project"]
		readGlobalSettingsStub.returns({ disabledPlugins: [DISABLED_PLUGIN] })
		getLatestPluginLoadReportStub.returns(report())
	})

	afterEach(() => {
		getLatestPluginLoadReportStub.reset()
		readGlobalSettingsStub.reset()
		listPluginToolsWithDiagnosticsStub.reset()
	})

	it("attaches the session's load failure to the plugin that could not be loaded", async () => {
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const byPath = new Map(entries.map((entry) => [entry.path, entry]))

		assert.equal(byPath.get(BROKEN_PLUGIN)?.error, "plugin-sandbox process exited (code=1)")
		assert.equal(byPath.get(HEALTHY_PLUGIN)?.error, undefined)
	})

	it("never loads plugins from the listing RPC", async () => {
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		await listLocalMarketplaceInstalledEntries(makeController())

		assert.equal(listPluginToolsWithDiagnosticsStub.callCount, 0)
	})

	it("reports nothing when no session has loaded plugins yet", async () => {
		getLatestPluginLoadReportStub.returns(undefined)
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())

		assert.equal(entries.filter((entry) => entry.type === "plugin").length, 3)
		assert.equal(
			entries.every((entry) => entry.error === undefined),
			true,
		)
	})

	it("does not report failures against disabled plugins", async () => {
		getLatestPluginLoadReportStub.returns(
			report({
				pluginPaths: [BROKEN_PLUGIN, HEALTHY_PLUGIN, DISABLED_PLUGIN],
				failures: [{ pluginPath: DISABLED_PLUGIN, phase: "load", message: "stale failure" }],
			}),
		)
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const disabled = entries.find((entry) => entry.path === DISABLED_PLUGIN)

		assert.equal(disabled?.enabled, false)
		assert.equal(disabled?.error, undefined)
	})

	it("redacts secrets that the sandbox echoed into the failure message", async () => {
		getLatestPluginLoadReportStub.returns(
			report({
				failures: [
					{
						pluginPath: BROKEN_PLUGIN,
						phase: "setup",
						message: "setup threw: request failed\nauthorization: Bearer sk-live-abcdef123456",
					},
				],
			}),
		)
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const message = entries.find((entry) => entry.path === BROKEN_PLUGIN)?.error ?? ""

		assert.equal(message.includes("sk-live-abcdef123456"), false)
		assert.equal(message.includes("[redacted]"), true)
	})

	it("flattens and truncates a long multi-line stack", async () => {
		getLatestPluginLoadReportStub.returns(
			report({
				failures: [
					{ pluginPath: BROKEN_PLUGIN, phase: "load", message: `boom\n${"    at frame (file.ts:1:1)\n".repeat(60)}` },
				],
			}),
		)
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())
		const message = entries.find((entry) => entry.path === BROKEN_PLUGIN)?.error ?? ""

		assert.equal(message.includes("\n"), false)
		assert.equal(message.length <= 401, true)
		assert.equal(message.startsWith("boom at frame"), true)
		assert.equal(message.endsWith("…"), true)
	})

	it("reports global plugins recorded by a folderless session", async () => {
		workspacePaths = []
		const { listLocalMarketplaceInstalledEntries } = await import("../marketplace-helpers")

		const { entries } = await listLocalMarketplaceInstalledEntries(makeController())

		assert.equal(entries.find((entry) => entry.path === BROKEN_PLUGIN)?.error, "plugin-sandbox process exited (code=1)")
	})
})
