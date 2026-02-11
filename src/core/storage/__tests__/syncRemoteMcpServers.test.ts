import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as diskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { syncRemoteMcpServersToSettings } from "../remote-config/syncRemoteMcpServers"

describe("syncRemoteMcpServersToSettings", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let settingsPath: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")

		sandbox.stub(diskModule, "getMcpSettingsFilePath").callsFake(async () => {
			try {
				await fs.access(settingsPath)
			} catch {
				await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: {} }, null, 2))
			}
			return settingsPath
		})
	})

	afterEach(async () => {
		sandbox.restore()
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	const writeSettings = async (mcpServers: Record<string, any>) => {
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers }, null, 2))
	}

	const readSettings = async () => {
		const content = await fs.readFile(settingsPath, "utf-8")
		return JSON.parse(content)
	}

	describe("adding remote servers", () => {
		it("should add a new remote server with remoteConfigured marker", async () => {
			await syncRemoteMcpServersToSettings([{ name: "test-server", url: "https://example.com/mcp" }], tempDir)

			const result = await readSettings()
			result.mcpServers["test-server"].should.have.property("url", "https://example.com/mcp")
			result.mcpServers["test-server"].should.have.property("remoteConfigured", true)
			result.mcpServers["test-server"].should.have.property("type", "streamableHttp")
			result.mcpServers["test-server"].should.have.property("disabled", false)
		})

		it("should preserve user settings and tag existing server with remoteConfigured marker", async () => {
			await writeSettings({
				"test-server": {
					url: "https://example.com/mcp",
					type: "streamableHttp",
					disabled: true, // user disabled it
					autoApprove: ["some-tool"],
				},
			})

			await syncRemoteMcpServersToSettings([{ name: "test-server", url: "https://example.com/mcp" }], tempDir)

			const result = await readSettings()
			result.mcpServers["test-server"].disabled.should.equal(true)
			result.mcpServers["test-server"].autoApprove.should.deepEqual(["some-tool"])
			result.mcpServers["test-server"].remoteConfigured.should.equal(true)
		})

		it("should add multiple remote servers", async () => {
			await writeSettings({})

			await syncRemoteMcpServersToSettings(
				[
					{ name: "server-a", url: "https://a.example.com" },
					{ name: "server-b", url: "https://b.example.com" },
				],
				tempDir,
			)

			const result = await readSettings()
			Object.keys(result.mcpServers).should.have.length(2)
			result.mcpServers["server-a"].url.should.equal("https://a.example.com")
			result.mcpServers["server-b"].url.should.equal("https://b.example.com")
		})

		it("should not affect existing non-remote servers", async () => {
			await writeSettings({
				"local-server": {
					command: "node",
					args: ["server.js"],
					type: "stdio",
				},
			})

			await syncRemoteMcpServersToSettings([{ name: "remote-server", url: "https://example.com" }], tempDir)

			const result = await readSettings()
			result.mcpServers.should.have.property("local-server")
			result.mcpServers["local-server"].command.should.equal("node")
			result.mcpServers.should.have.property("remote-server")
		})
	})

	describe("removing remote servers", () => {
		it("should remove a server marked remoteConfigured when no longer in remote config", async () => {
			await writeSettings({
				"old-server": {
					url: "https://old.example.com",
					type: "streamableHttp",
					remoteConfigured: true,
				},
			})

			await syncRemoteMcpServersToSettings([], tempDir)

			const result = await readSettings()
			result.mcpServers.should.not.have.property("old-server")
		})

		it("should NOT remove a server without remoteConfigured marker", async () => {
			await writeSettings({
				"user-server": {
					url: "https://user.example.com",
					type: "streamableHttp",
				},
			})

			await syncRemoteMcpServersToSettings([], tempDir)

			const result = await readSettings()
			result.mcpServers.should.have.property("user-server")
		})

		it("should only remove the server that was removed from remote config", async () => {
			await writeSettings({
				"keep-server": {
					url: "https://keep.example.com",
					type: "streamableHttp",
					remoteConfigured: true,
				},
				"remove-server": {
					url: "https://remove.example.com",
					type: "streamableHttp",
					remoteConfigured: true,
				},
			})

			await syncRemoteMcpServersToSettings([{ name: "keep-server", url: "https://keep.example.com" }], tempDir)

			const result = await readSettings()
			result.mcpServers.should.have.property("keep-server")
			result.mcpServers.should.not.have.property("remove-server")
		})

		it("should handle removing all remote servers at once", async () => {
			await writeSettings({
				"server-a": { url: "https://a.com", type: "streamableHttp", remoteConfigured: true },
				"server-b": { url: "https://b.com", type: "streamableHttp", remoteConfigured: true },
				"local-server": { command: "node", type: "stdio" },
			})

			await syncRemoteMcpServersToSettings([], tempDir)

			const result = await readSettings()
			result.mcpServers.should.not.have.property("server-a")
			result.mcpServers.should.not.have.property("server-b")
			result.mcpServers.should.have.property("local-server")
		})
	})

	describe("upgrade from old format (no remoteConfigured marker)", () => {
		it("should add remoteConfigured marker to existing server matching remote config", async () => {
			await writeSettings({
				"legacy-server": {
					url: "https://legacy.example.com",
					type: "streamableHttp",
					disabled: false,
				},
			})

			await syncRemoteMcpServersToSettings([{ name: "legacy-server", url: "https://legacy.example.com" }], tempDir)

			const result = await readSettings()
			result.mcpServers["legacy-server"].remoteConfigured.should.equal(true)
		})
	})

	describe("edge cases", () => {
		it("should handle empty settings file with no mcpServers key", async () => {
			await fs.writeFile(settingsPath, JSON.stringify({}, null, 2))

			await syncRemoteMcpServersToSettings([{ name: "new-server", url: "https://new.example.com" }], tempDir)

			const result = await readSettings()
			result.mcpServers["new-server"].url.should.equal("https://new.example.com")
			result.mcpServers["new-server"].remoteConfigured.should.equal(true)
		})

		it("should handle server with same name but different URL", async () => {
			await writeSettings({
				"my-server": {
					url: "https://old-url.example.com",
					type: "streamableHttp",
					remoteConfigured: true,
				},
			})

			await syncRemoteMcpServersToSettings([{ name: "my-server", url: "https://new-url.example.com" }], tempDir)

			const result = await readSettings()
			result.mcpServers["my-server"].url.should.equal("https://new-url.example.com")
			result.mcpServers["my-server"].remoteConfigured.should.equal(true)
		})

		it("should set McpHub isUpdatingFromRemoteConfig flag during write", async () => {
			await writeSettings({})

			const mockMcpHub = {
				setIsUpdatingFromRemoteConfig: sandbox.stub(),
			}

			await syncRemoteMcpServersToSettings([{ name: "test", url: "https://test.com" }], tempDir, mockMcpHub as any)

			mockMcpHub.setIsUpdatingFromRemoteConfig.calledWith(true).should.be.true()
			mockMcpHub.setIsUpdatingFromRemoteConfig.calledWith(false).should.be.true()

			const calls = mockMcpHub.setIsUpdatingFromRemoteConfig.getCalls()
			calls[0].args[0].should.equal(true)
			calls[1].args[0].should.equal(false)
		})
	})
})
