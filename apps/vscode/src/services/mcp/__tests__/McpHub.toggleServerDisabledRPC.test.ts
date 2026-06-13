import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as diskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { McpHub } from "../McpHub"

// Regression tests for McpHub.toggleServerDisabledRPC(): toggling a server off
// then on must REBUILD the connection, not just flip an in-memory flag. A
// disabled server's connection has no live transport/client, so previously a
// re-enabled server stayed stuck "connecting" (yellow dot) and was never
// advertised to the agent. Tests bypass the constructor's watcher via
// Object.create(McpHub.prototype), matching the sibling McpHub tests.

type FakeConnection = {
	server: { name: string; config: string; status: string; disabled: boolean }
	client: Record<string, unknown> | null
	transport: Record<string, unknown> | null
}

function makeConnection(name: string, disabled: boolean): FakeConnection {
	return {
		server: {
			name,
			config: JSON.stringify({ type: "stdio", command: "test", timeout: 60, disabled }),
			status: disabled ? "disconnected" : "connected",
			disabled,
		},
		client: disabled ? null : {},
		transport: disabled ? null : {},
	}
}

describe("McpHub.toggleServerDisabledRPC", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let settingsPath: string
	let hub: McpHub
	let connectArgs: Array<{ name: string; disabled: boolean }>
	let notifyCount: number

	const writeSettings = async (mcpServers: Record<string, unknown>) => {
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers }, null, 2))
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-toggle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		sandbox.stub(diskModule, "getMcpSettingsFilePath").resolves(settingsPath)

		connectArgs = []
		notifyCount = 0

		hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).getSettingsDirectoryPath = async () => tempDir
		;(hub as any).connections = []
		;(hub as any).isConnecting = false
		// deleteConnection just drops the connection from the in-memory list.
		sandbox.stub(hub as any, "deleteConnection").callsFake(async (...args: unknown[]) => {
			const name = args[0] as string
			;(hub as any).connections = (hub as any).connections.filter((c: FakeConnection) => c.server.name !== name)
		})
		// connectToServer records the (name, disabled) it was asked to build and
		// pushes a connection matching what the real method would create.
		sandbox.stub(hub as any, "connectToServer").callsFake(async (...args: unknown[]) => {
			const name = args[0] as string
			const config = args[1] as { disabled?: boolean }
			connectArgs.push({ name, disabled: Boolean(config.disabled) })
			;(hub as any).connections.push(makeConnection(name, Boolean(config.disabled)))
		})
		sandbox.stub(hub as any, "notifyWebviewOfServerChanges").callsFake(async () => {
			notifyCount++
		})
		// The error path calls HostProvider.window.showMessage; stub the static
		// getter so it's harmless without a fully-initialized HostProvider.
		sandbox.stub(HostProvider, "window").get(() => ({ showMessage: sinon.stub().resolves({}) }))
	})

	afterEach(async () => {
		sandbox.restore()
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	it("persists disabled=true and rebuilds the connection when disabling", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a" } })
		;(hub as any).connections = [makeConnection("alpha", false)]

		await hub.toggleServerDisabledRPC("alpha", true)

		const persisted = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		persisted.mcpServers.alpha.disabled.should.equal(true)
		// Rebuilt as a disabled connection.
		connectArgs.should.deepEqual([{ name: "alpha", disabled: true }])
		notifyCount.should.be.greaterThan(0)
	})

	it("reconnects (not stuck connecting) when re-enabling a disabled server", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a", disabled: true } })
		;(hub as any).connections = [makeConnection("alpha", false)]
		;(hub as any).connections[0].server.disabled = true
		;(hub as any).connections[0].client = null
		;(hub as any).connections[0].transport = null

		const result = await hub.toggleServerDisabledRPC("alpha", false)

		// File reflects enabled.
		const persisted = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		persisted.mcpServers.alpha.disabled.should.equal(false)
		// The connection was actually rebuilt as enabled — this is the fix: a
		// real connect happens rather than just flipping the flag to "connecting".
		connectArgs.should.deepEqual([{ name: "alpha", disabled: false }])
		// The returned (and in-memory) server is enabled and connected, not
		// stuck on the "connecting" yellow state.
		const alpha = result.find((s) => s.name === "alpha")
		alpha!.disabled!.should.equal(false)
		alpha!.status.should.equal("connected")
	})

	it("throws when the server is not found", async () => {
		await writeSettings({ beta: { type: "stdio", command: "b" } })

		let threw: Error | undefined
		try {
			await hub.toggleServerDisabledRPC("missing", true)
		} catch (err) {
			threw = err as Error
		}
		;(threw === undefined).should.be.false()
		threw!.message.should.match(/not found in MCP configuration/)
		connectArgs.should.have.length(0)
	})
})
