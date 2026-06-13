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

	it("writes atomically (temp file + rename), never truncating the real file", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a" }, beta: { type: "stdio", command: "b" } })

		// A reader must never observe the real settings file in a truncated or
		// empty state, since a client that reads it mid-write could conclude
		// there are no servers. A temp-file + rename guarantees the real path only
		// ever flips from the complete old file to the complete new one, so
		// writeFile must target a different path than the settings file.
		const realWriteFile = fs.writeFile.bind(fs)
		const writeTargets: string[] = []
		sandbox.stub(fs, "writeFile").callsFake((...args: unknown[]) => {
			writeTargets.push(String(args[0]))
			return (realWriteFile as (...a: unknown[]) => Promise<void>)(...args)
		})

		await hub.deleteServerRPC("alpha")

		writeTargets.length.should.be.greaterThan(0)
		writeTargets.every((target) => target !== settingsPath).should.be.true()
		// The final file is complete and correct.
		const persisted = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		Object.keys(persisted.mcpServers).should.deepEqual(["beta"])
	})

	it("pre-seeds the connection fingerprint so the watcher skips its own write", async () => {
		await writeSettings({ alpha: { type: "stdio", command: "a" }, beta: { type: "stdio", command: "b" } })

		await hub.deleteServerRPC("alpha")

		// After the write, lastConnectionFingerprint reflects the just-written
		// content, so the watcher's "change" event for our own write is a no-op.
		const expected = (hub as any).computeConnectionFingerprint({ beta: { type: "stdio", command: "b" } })
		;(hub as any).lastConnectionFingerprint.should.equal(expected)
	})

	it("throws when the server is not found", async () => {
		await writeSettings({ beta: { type: "stdio", command: "b" } })

		let threw: Error | undefined
		try {
			await hub.deleteServerRPC("missing")
		} catch (err) {
			threw = err as Error
		}
		;(threw === undefined).should.be.false()
		threw!.message.should.match(/not found in MCP configuration/)
	})
})
