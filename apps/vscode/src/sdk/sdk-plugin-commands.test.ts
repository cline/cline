import { describe, expect, it, vi } from "vitest"
import { normalizePluginCommandName, SdkPluginCommandCoordinator } from "./sdk-plugin-commands"

describe("SdkPluginCommandCoordinator", () => {
	it("loads plugins from the active workspace", async () => {
		const loadPlugins = vi.fn(async () => ({
			extensions: [],
			pluginPaths: [],
			failures: [],
			warnings: [],
		}))
		const coordinator = new SdkPluginCommandCoordinator({
			getWorkspaceRoot: async () => "/workspace/project",
			loadPlugins,
		})

		await coordinator.getSlashCommands()

		expect(loadPlugins).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/workspace/project",
				workspacePath: "/workspace/project",
			}),
		)
	})

	it("normalizes plugin command names like the CLI", () => {
		expect(normalizePluginCommandName(" /Goal ")).toBe("goal")
		expect(normalizePluginCommandName("GOAL")).toBe("goal")
	})
})
