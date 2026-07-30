import { afterEach, describe, expect, it, vi } from "vitest"

// Heavy SDK dependencies are not needed; stub them out before importing the helpers.
vi.mock("@cline/core", () => ({
	installMcpServer: vi.fn(),
	isMarketplaceSkillInstalled: vi.fn().mockReturnValue(false),
	parseMcpInstallArgs: vi.fn().mockReturnValue({ name: "test" }),
	uninstallMarketplaceEntry: vi.fn(),
}))
vi.mock("@core/controller/file/refreshSkills", () => ({ refreshSkills: vi.fn().mockResolvedValue({ globalSkills: [], localSkills: [] }) }))
vi.mock("@core/controller/file/deleteSkillFile", () => ({ deleteSkillFile: vi.fn() }))
vi.mock("@core/controller/file/toggleSkill", () => ({ toggleSkill: vi.fn() }))
vi.mock("@/hosts/host-provider", () => ({ HostProvider: { isInitialized: () => false } }))
vi.mock("@/shared/net", () => ({ fetch: vi.fn() }))

describe("marketplace-helpers plugin guard", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it("installMarketplaceEntryFromCatalog rejects plugin entries", async () => {
		const { installMarketplaceEntryFromCatalog } = await import(
			"../marketplace-helpers"
		)
		await expect(
			installMarketplaceEntryFromCatalog({
				id: "my-plugin",
				type: "plugin",
				name: "My Plugin",
				install: { args: ["https://github.com/example/plugin.git"] },
				tags: [],
				tagObjects: [],
			}),
		).rejects.toThrow("Plugin installation is not supported in the VS Code extension.")
	})

	it("toggleLocalMarketplaceInstalledEntry rejects plugin entries", async () => {
		const { toggleLocalMarketplaceInstalledEntry } = await import(
			"../marketplace-helpers"
		)
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const controller = { mcpHub: undefined, stateManager: undefined } as any
		await expect(
			toggleLocalMarketplaceInstalledEntry(controller, {
				entry: {
					id: "/home/user/.cline/plugins/my-plugin",
					type: "plugin",
					name: "My Plugin",
					path: "/home/user/.cline/plugins/my-plugin",
					source: "global",
					enabled: true,
				},
				enabled: false,
			}),
		).rejects.toThrow("Plugin management is not supported in the VS Code extension.")
	})

	it("uninstallLocalMarketplaceInstalledEntry rejects plugin entries", async () => {
		const { uninstallLocalMarketplaceInstalledEntry } = await import(
			"../marketplace-helpers"
		)
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const controller = { mcpHub: undefined } as any
		await expect(
			uninstallLocalMarketplaceInstalledEntry(controller, {
				entry: {
					id: "/home/user/.cline/plugins/my-plugin",
					type: "plugin",
					name: "My Plugin",
					path: "/home/user/.cline/plugins/my-plugin",
					source: "global",
					enabled: true,
				},
			}),
		).rejects.toThrow("Plugin management is not supported in the VS Code extension.")
	})

	it("listLocalMarketplaceInstalledEntries never returns plugin entries", async () => {
		const { listLocalMarketplaceInstalledEntries } = await import(
			"../marketplace-helpers"
		)
		const controller = {
			mcpHub: { getServers: () => [] },
			stateManager: undefined,
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any
		const result = await listLocalMarketplaceInstalledEntries(controller)
		const pluginEntries = result.entries.filter((e) => e.type === "plugin")
		expect(pluginEntries).toHaveLength(0)
	})
})