import * as fs from "node:fs/promises"
import { createServer } from "node:http"
import * as os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClineEndpoint, ClineEnv, Environment } from "@/config"
import { startLocalCloudDevelopment } from "@/dev/local-cloud-development"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { startLocalCloudEnvironment } from "./local-cloud-environment"

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>()
	return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

describe("local cloud development ownership", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	it("removes both roots when a real listener already owns the requested port", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		const listener = createServer()
		try {
			await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
			const address = listener.address()
			if (!address || typeof address === "string") throw new Error("No port")
			await expect(startLocalCloudDevelopment({ port: address.port, tempDir })).rejects.toMatchObject({
				code: "EADDRINUSE",
			})
			expect(await fs.readdir(tempDir)).toEqual([])
			expect(listener.listening).toBe(true)
		} finally {
			await new Promise<void>((resolve) => listener.close(() => resolve()))
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("closes a bound fixture and removes its profile when writing settings fails", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		const write = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"))
		try {
			await expect(startLocalCloudDevelopment({ port: 0, tempDir })).rejects.toThrow("disk full")
			expect(await fs.readdir(tempDir)).toEqual([])
		} finally {
			write.mockRestore()
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("generates app and GitHub links through the real extension environment and service", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		try {
			vi.stubEnv("HOME", development.clineDir)
			vi.stubEnv("USERPROFILE", development.clineDir)
			for (const [key, value] of Object.entries(development.launchEnv)) vi.stubEnv(key, value)
			await ClineEndpoint.initialize(development.clineDir)
			const service = new CloudSessionsService({
				getAuthToken: async () => development.environment.accessToken,
				getActiveOrganizationId: () => undefined,
			})
			expect(ClineEnv.config().apiBaseUrl).toBe(development.environment.apiBaseUrl)
			expect(ClineEnv.config().mcpBaseUrl).toBe(`${development.environment.apiBaseUrl}/v1/mcp`)
			for (const url of [service.dashboardUrl("ses-local"), service.githubConnectUrl()]) {
				expect(new URL(url).origin).toBe(development.environment.apiBaseUrl)
				expect((await fetch(url)).status).toBe(200)
			}
			vi.stubEnv("CLINE_LOCAL_CLOUD_URL", "https://example.com")
			expect(() => ClineEnv.config()).toThrow("loopback")
			ClineEnv.setEnvironment(Environment.production)
			expect(ClineEnv.config().appBaseUrl).toBe("https://app.cline.bot")
		} finally {
			await Promise.all([development.dispose(), development.dispose()])
			await expect(fs.access(development.clineDir)).rejects.toThrow()
		}
	})

	it("removes a fixture root on invalid bind arguments as well as listener errors", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		try {
			await expect(startLocalCloudEnvironment({ tempDir, port: -1 })).rejects.toThrow()
			expect(await fs.readdir(tempDir)).toEqual([])
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("reports sandbox cleanup failure after closing the listener and removing the profile", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		const service = new CloudSessionsService({
			apiBaseUrl: development.environment.apiBaseUrl,
			getAuthToken: async () => development.environment.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
		const sandbox = await development.environment.activateSession(record.id)
		if (!sandbox.hub) throw new Error("Expected a real Hub")
		const close = sandbox.hub.close.bind(sandbox.hub)
		vi.spyOn(sandbox.hub, "close").mockImplementation(async () => {
			await close()
			throw new Error("cleanup failure")
		})
		await expect(development.dispose()).rejects.toThrow("Local cloud sandbox cleanup failed")
		await expect(fs.access(development.clineDir)).rejects.toThrow()
		await expect(fetch(`${development.environment.apiBaseUrl}/health`)).rejects.toThrow()
		await expect(development.dispose()).rejects.toThrow("Local cloud sandbox cleanup failed")
	})
})
