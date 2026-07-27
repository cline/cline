import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isSettingsLockContentionError, updateMcpSettingsFile } from "../settingsLock"

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

	it.each(["EEXIST", "ENOTEMPTY"])("treats %s from lock-directory publication as contention", (code) => {
		expect(isSettingsLockContentionError({ code })).toBe(true)
	})

	it("does not hide unrelated lock-directory errors", () => {
		expect(isSettingsLockContentionError({ code: "EACCES" })).toBe(false)
		expect(isSettingsLockContentionError(null)).toBe(false)
		expect(isSettingsLockContentionError(undefined)).toBe(false)
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

	it("redacts persisted oauth diagnostics on unrelated locked updates", async () => {
		await fs.writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: { type: "streamableHttp", url: "https://mcp.linear.app/mcp" },
							oauth: { lastError: "access_token=legacy-secret" },
						},
					},
				},
				null,
				2,
			),
		)

		await updateMcpSettingsFile(settingsPath, (settings) => {
			const servers = settings.mcpServers as Record<string, Record<string, unknown>>
			servers.linear.disabled = true
		})

		const written = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		expect(written.mcpServers.linear.disabled).toBe(true)
		expect(written.mcpServers.linear.oauth.lastError).toBe("access_token=[REDACTED]")
	})

	it("creates a missing settings file inside the lock", async () => {
		const missingPath = path.join(tempDir, "fresh", "cline_mcp_settings.json")
		const previousUmask = process.platform === "win32" ? undefined : process.umask(0o777)

		try {
			await updateMcpSettingsFile(missingPath, (settings) => {
				settings.mcpServers = { alpha: { type: "stdio", command: "node" } }
			})
		} finally {
			if (previousUmask !== undefined) {
				process.umask(previousUmask)
			}
		}

		const written = JSON.parse(await fs.readFile(missingPath, "utf-8"))
		expect(Object.keys(written.mcpServers)).toEqual(["alpha"])
		expect(existsSync(`${missingPath}.lock`)).toBe(false)
		if (process.platform !== "win32") {
			expect((await fs.stat(path.dirname(missingPath))).mode & 0o777).toBe(0o700)
			expect((await fs.stat(missingPath)).mode & 0o777).toBe(0o600)
		}
	})

	it.skipIf(process.platform === "win32")("hardens an insecure file without changing its existing parent", async () => {
		await fs.chmod(tempDir, 0o755)
		await fs.chmod(settingsPath, 0o644)

		await updateMcpSettingsFile(settingsPath, (settings) => {
			settings.mcpServers = { alpha: { type: "stdio", command: "node" } }
		})

		expect((await fs.stat(tempDir)).mode & 0o777).toBe(0o755)
		expect((await fs.stat(settingsPath)).mode & 0o777).toBe(0o600)
	})

	it.skipIf(process.platform === "win32")("repairs an existing Cline-owned settings directory", async () => {
		const previousDataDir = process.env.CLINE_DATA_DIR
		const dataDir = path.join(tempDir, "cline-data")
		const ownedSettingsDir = path.join(dataDir, "settings")
		const ownedSettingsPath = path.join(ownedSettingsDir, "cline_mcp_settings.json")
		await fs.mkdir(ownedSettingsDir, { recursive: true, mode: 0o755 })
		await fs.chmod(ownedSettingsDir, 0o755)
		await fs.writeFile(ownedSettingsPath, JSON.stringify({ mcpServers: {} }, null, 2))
		process.env.CLINE_DATA_DIR = dataDir

		try {
			await updateMcpSettingsFile(ownedSettingsPath, (settings) => {
				settings.mcpServers = { alpha: { type: "stdio", command: "node" } }
			})
			expect((await fs.stat(ownedSettingsDir)).mode & 0o777).toBe(0o700)
		} finally {
			if (previousDataDir === undefined) {
				delete process.env.CLINE_DATA_DIR
			} else {
				process.env.CLINE_DATA_DIR = previousDataDir
			}
		}
	})
})
