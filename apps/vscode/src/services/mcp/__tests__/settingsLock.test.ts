import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { updateMcpSettingsFile } from "../settingsLock"

describe("updateMcpSettingsFile", () => {
	let tempDir: string
	let settingsPath: string

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `mcp-settings-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: {} }, null, 2))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("does not yield while holding the settings lock", async () => {
		let mutatorRan = false

		const update = updateMcpSettingsFile(settingsPath, (settings) => {
			mutatorRan = true
			settings.mcpServers = {
				alpha: {
					type: "stdio",
					command: "node",
				},
			}
			return "updated"
		})

		expect(mutatorRan).toBe(true)
		expect(existsSync(`${settingsPath}.lock`)).toBe(false)
		await expect(update).resolves.toBe("updated")
	})
})
