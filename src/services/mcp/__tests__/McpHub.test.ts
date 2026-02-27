import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import chokidar from "chokidar"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { McpHub } from "../McpHub"

/**
 * Builds a minimal McpHub with prototype-level stubs for watchMcpSettingsFile and
 * initializeMcpServers so constructor side-effects don't interfere with tests.
 */
async function buildHub(
	sandbox: sinon.SinonSandbox,
	settingsDir: string,
): Promise<{ hub: McpHub; connectStub: sinon.SinonStub }> {
	// HostProvider must be initialized so error-path showMessage calls don't throw
	setVscodeHostProviderMock()

	// Prevent chokidar from watching real files
	sandbox.stub(chokidar, "watch").returns({ on: () => {}, close: async () => {} } as any)

	// Prevent constructor background tasks from running
	sandbox.stub(McpHub.prototype as any, "watchMcpSettingsFile").resolves()
	sandbox.stub(McpHub.prototype as any, "initializeMcpServers").resolves()

	const hub = new McpHub(
		async () => settingsDir,
		async () => settingsDir,
		"1.0.0",
		{ captureMcpToolCall: () => {} } as any,
	)

	// Default stub: re-adds the connection after deleteConnection removes it so the
	// returned server list is non-empty. Individual tests can override via callsFake.
	const connectStub = sandbox.stub(hub as any, "connectToServer").callsFake(async (...args: unknown[]) => {
		const name = args[0] as string
		const config = args[1] as any
		;(hub as any).connections.push({
			server: { name, config: JSON.stringify(config), status: "connected", disabled: false },
			client: {},
			transport: {},
		})
	})

	return { hub, connectStub }
}

describe("McpHub", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let settingsPath: string

	const serverConfig = {
		command: "node",
		args: ["server.js"],
		type: "stdio" as const,
		disabled: false,
		autoApprove: [],
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-hub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
	})

	afterEach(async () => {
		sandbox.restore()
		HostProvider.reset()
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	describe("toggleServerDisabledRPC", () => {
		describe("disabling a server", () => {
			it("writes disabled:true to the settings file", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: false } } }, null, 2),
				)

				const { hub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "connected",
							disabled: false,
						},
						client: {},
						transport: {},
					},
				]

				await hub.toggleServerDisabledRPC("test-server", true)

				const saved = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
				saved.mcpServers["test-server"].disabled.should.be.true()
			})

			it("updates in-memory connection.server.disabled to true", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: false } } }, null, 2),
				)

				const { hub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "connected",
							disabled: false,
						},
						client: {},
						transport: {},
					},
				]

				await hub.toggleServerDisabledRPC("test-server", true)

				const conn = (hub as any).connections.find((c: any) => c.server.name === "test-server")
				conn.server.disabled.should.be.true()
			})

			it("does not call connectToServer when disabling", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: false } } }, null, 2),
				)

				const { hub, connectStub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "connected",
							disabled: false,
						},
						client: {},
						transport: {},
					},
				]

				await hub.toggleServerDisabledRPC("test-server", true)

				connectStub.called.should.be.false()
			})
		})

		describe("enabling a server", () => {
			it("writes disabled:false to the settings file", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "disconnected",
							disabled: true,
						},
						client: null,
						transport: null,
					},
				]

				await hub.toggleServerDisabledRPC("test-server", false)

				const saved = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
				saved.mcpServers["test-server"].disabled.should.be.false()
			})

			it("sets server status to 'connecting' and clears error when enabling", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub, connectStub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "disconnected",
							disabled: true,
							error: "previous error",
						},
						client: null,
						transport: null,
					},
				]

				await hub.toggleServerDisabledRPC("test-server", false)

				// Main does not call connectToServer — it just marks the server as connecting
				// so the webview/watcher can pick it up
				connectStub.called.should.be.false()
				const conn = (hub as any).connections.find((c: any) => c.server.name === "test-server")
				conn.server.disabled.should.be.false()
				conn.server.status.should.equal("connecting")
				conn.server.error.should.equal("")
			})

			it("does not modify isUpdatingClineSettings when enabling", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "disconnected",
							disabled: true,
						},
						client: null,
						transport: null,
					},
				]

				await hub.toggleServerDisabledRPC("test-server", false)

				// Main's implementation does not use isUpdatingClineSettings in toggleServerDisabledRPC
				;(hub as any).isUpdatingClineSettings.should.be.false()
			})

			it("returns the updated server list with disabled:false", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "disconnected",
							disabled: true,
						},
						client: null,
						transport: null,
					},
				]

				const result = await hub.toggleServerDisabledRPC("test-server", false)

				result.should.be.an.Array()
				result.length.should.equal(1)
				result[0].name.should.equal("test-server")
				;(result[0].disabled ?? false).should.be.false()
			})

			it("does not throw when connectToServer fails (connection error is swallowed)", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub, connectStub } = await buildHub(sandbox, tempDir)
				;(hub as any).connections = [
					{
						server: {
							name: "test-server",
							config: JSON.stringify(serverConfig),
							status: "disconnected",
							disabled: true,
						},
						client: null,
						transport: null,
					},
				]

				connectStub.rejects(new Error("Connection refused"))

				// Should not throw — connectToServer failure is caught internally
				const result = await hub.toggleServerDisabledRPC("test-server", false)
				result.should.be.an.Array()
			})

			it("does nothing to in-memory state when enabling with no existing connection", async () => {
				await fs.writeFile(
					settingsPath,
					JSON.stringify({ mcpServers: { "test-server": { ...serverConfig, disabled: true } } }, null, 2),
				)

				const { hub, connectStub } = await buildHub(sandbox, tempDir)
				// Edge case: settings has server but no in-memory connection object exists
				;(hub as any).connections = []

				const result = await hub.toggleServerDisabledRPC("test-server", false)

				// No connection to update, no reconnect attempted
				connectStub.called.should.be.false()
				;(hub as any).connections.should.have.length(0)
				// Should still return the server list (sorted from settings)
				result.should.be.an.Array()
			})
		})

		describe("error handling", () => {
			it("throws when server name is not found in settings", async () => {
				await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: {} }, null, 2))

				const { hub } = await buildHub(sandbox, tempDir)

				try {
					await hub.toggleServerDisabledRPC("nonexistent", false)
					throw new Error("Should have thrown")
				} catch (err: any) {
					err.message.should.containEql("nonexistent")
				}
			})
		})
	})
})
