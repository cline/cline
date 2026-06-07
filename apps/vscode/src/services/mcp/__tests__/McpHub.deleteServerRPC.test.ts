import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as diskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { McpHub } from "../McpHub"

// Regression tests for McpHub.deleteServerRPC(): deleting one server must not
// empty the list. Tests bypass the constructor's watcher via
// Object.create(McpHub.prototype), matching McpHub.callTool.test.ts.

type FakeConnection = {
	server: { name: string; config: string; status: string; disabled: boolean }
	client: Record<string, unknown>
	transport: Record<string, unknown>
}

function makeConnection(name: string): FakeConnection {
	return {
		server: {
			name,
			config: JSON.stringify({ type: "stdio", command: "test", timeout: 60 }),
			status: "connected",
			disabled: false,
		},
		client: {},
		transport: {},
	}
}

describe("McpHub.deleteServerRPC", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let settingsPath: string
	let hub: McpHub

	const writeSettings = async (mcpServers: Record<string, unknown>) => {
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers }, null, 2))
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-delete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		sandbox.stub(diskModule, "getMcpSettingsFilePath").resolves(settingsPath)

		hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).getSettingsDirectoryPath = async () => tempDir
		;(hub as any).isUpdatingClineSettings = false
		;(hub as any).connections = [makeConnection("alpha"), makeConnection("beta")]
		// clearOAuthForConnection touches the OAuth manager; stub it out.
		sandbox.stub(hub as any, "clearOAuthForConnection").resolves()
		// updateServerConnectionsRPC normally opens real transports; reproduce only
		// the relevant behavior: drop connections no longer present in the new set.
		sandbox.stub(hub as any, "updateServerConnectionsRPC").callsFake((...args: unknown[]) => {
			const newServers = args[0] as Record<string, unknown>
			;(hub as any).connections = (hub as any).connections.filter((c: FakeConnection) =>
				Object.hasOwn(newServers, c.server.name),
			)
			return Promise.resolve()
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

	it("returns the remaining servers (not an empty list) after deleting one", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a" }, beta: { type: "stdio", command: "b" } })

		const result = await hub.deleteServerRPC("alpha")

		result.should.have.length(1)
		result.map((s) => s.name).should.deepEqual(["beta"])
	})

	it("persists the remaining server to the settings file", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a" }, beta: { type: "stdio", command: "b" } })

		await hub.deleteServerRPC("alpha")

		const persisted = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		Object.keys(persisted.mcpServers).should.deepEqual(["beta"])
	})

	it("guards the write with isUpdatingClineSettings so the watcher skips its own event", async () => {
		const clock = sandbox.useFakeTimers()
		await writeSettings({ alpha: { type: "stdio", command: "a" }, beta: { type: "stdio", command: "b" } })

		// Capture the flag at the moment the settings file is written.
		let flagDuringWrite: boolean | undefined
		const realWriteFile = fs.writeFile.bind(fs)
		sandbox.stub(fs, "writeFile").callsFake((...args: unknown[]) => {
			flagDuringWrite = (hub as any).isUpdatingClineSettings
			return (realWriteFile as (...a: unknown[]) => Promise<void>)(...args)
		})

		await hub.deleteServerRPC("alpha")

		// True during the write and still true immediately after (cleared on a timer).
		flagDuringWrite!.should.be.true()
		;(hub as any).isUpdatingClineSettings.should.be.true()

		// The flag is cleared on a 300ms timer so external edits resume.
		clock.tick(300)
		;(hub as any).isUpdatingClineSettings.should.be.false()
	})

	it("throws and still clears the guard when the server is not found", async () => {
		const clock = sandbox.useFakeTimers()
		await writeSettings({ beta: { type: "stdio", command: "b" } })

		let threw: Error | undefined
		try {
			await hub.deleteServerRPC("missing")
		} catch (err) {
			threw = err as Error
		}
		;(threw === undefined).should.be.false()
		threw!.message.should.match(/not found in MCP configuration/)

		clock.tick(300)
		;(hub as any).isUpdatingClineSettings.should.be.false()
	})
})
