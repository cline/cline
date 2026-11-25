import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import * as actualDiskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"
import should from "should"
import sinon from "sinon"

// bun loads real ESM, so the settings path is replaced through mock.module on
// the specifiers McpHub imports, as in McpHub.deleteServerRPC.test.ts.
const getMcpSettingsFilePathStub: sinon.SinonStub = sinon.stub()
const diskMock = () => ({ ...actualDiskModule, getMcpSettingsFilePath: getMcpSettingsFilePathStub })
mock.module("@core/storage/disk", diskMock)
mock.module("@/core/storage/disk", diskMock)

import { getPlanModeApproval } from "@/sdk/sdk-tool-policies"
import { McpHub } from "../McpHub"

// Tests for McpHub.setPlanModeAccess(): the override must reach the settings
// file, the in-memory server the approval callback reads, and the session
// rebuild trigger. The hub is built without its constructor, like the sibling
// McpHub tests.

describe("McpHub.setPlanModeAccess", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let settingsPath: string
	let hub: McpHub
	let captureOverride: sinon.SinonStub
	let toolListChanged: sinon.SinonStub

	const readServer = async (name: string) => JSON.parse(await fs.readFile(settingsPath, "utf-8")).mcpServers[name]

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `mcp-plan-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		getMcpSettingsFilePathStub.resolves(settingsPath)
		await fs.writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					ide: { type: "stdio", command: "ide", autoApprove: ["rename"] },
					other: { type: "stdio", command: "other" },
				},
			}),
		)

		captureOverride = sandbox.stub()
		toolListChanged = sandbox.stub()
		hub = Object.create(McpHub.prototype) as McpHub
		Object.assign(hub as any, {
			getSettingsDirectoryPath: async () => tempDir,
			telemetryService: { captureMcpPlanModeOverride: captureOverride },
			connections: [
				{
					server: {
						name: "ide",
						config: JSON.stringify({ type: "stdio", command: "ide", timeout: 60 }),
						status: "connected",
						tools: [
							{ name: "rename", annotations: { readOnlyHint: false } },
							{ name: "run", autoApprove: true },
						],
					},
				},
			],
		})
		hub.setToolListChangeCallback(toolListChanged)
	})

	afterEach(async () => {
		hub.clearToolListChangeCallback()
		sandbox.restore()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("saves a tool override next to the server's other settings", async () => {
		await hub.setPlanModeAccess("ide", true, ["run"])

		should(await readServer("ide")).deepEqual({
			type: "stdio",
			command: "ide",
			autoApprove: ["rename"],
			allowInPlanMode: ["run"],
		})
		should(await readServer("other")).deepEqual({ type: "stdio", command: "other" })
	})

	it("adds each tool once and removes it again", async () => {
		await hub.setPlanModeAccess("ide", true, ["run"])
		await hub.setPlanModeAccess("ide", true, ["run", "rename"])
		should((await readServer("ide")).allowInPlanMode).deepEqual(["run", "rename"])

		await hub.setPlanModeAccess("ide", false, ["run"])
		should((await readServer("ide")).allowInPlanMode).deepEqual(["rename"])
	})

	it("saves a whole-server override without touching the tool list", async () => {
		await hub.setPlanModeAccess("ide", true, ["run"])
		await hub.setPlanModeAccess("ide", true)

		const saved = await readServer("ide")
		should(saved.allowAllInPlanMode).be.true()
		should(saved.allowInPlanMode).deepEqual(["run"])
	})

	it("returns servers that carry the override and keep their other tool settings", async () => {
		const [server] = await hub.setPlanModeAccess("ide", true, ["run"])

		should(server.allowAllInPlanMode).be.false()
		should(server.tools).deepEqual([
			{ name: "rename", annotations: { readOnlyHint: false } },
			{ name: "run", autoApprove: true, allowInPlanMode: true },
		])
	})

	it("keeps the override in the config a restart reconnects from", async () => {
		const [server] = await hub.setPlanModeAccess("ide", true)
		await hub.setPlanModeAccess("ide", true, ["run"])

		should(JSON.parse(server.config)).deepEqual({
			type: "stdio",
			command: "ide",
			timeout: 60,
			allowInPlanMode: ["run"],
			allowAllInPlanMode: true,
		})
	})

	it("stops Plan mode asking about the tool once the user allows it", async () => {
		should(getPlanModeApproval("ide__run", "plan", hub)).equal("ask")

		await hub.setPlanModeAccess("ide", true, ["run"])
		should(getPlanModeApproval("ide__run", "plan", hub)).be.undefined()

		await hub.setPlanModeAccess("ide", false, ["run"])
		should(getPlanModeApproval("ide__run", "plan", hub)).equal("ask")
	})

	it("stops Plan mode asking about every tool once the user allows the server", async () => {
		await hub.setPlanModeAccess("ide", true)

		should(getPlanModeApproval("ide__run", "plan", hub)).be.undefined()
		should(getPlanModeApproval("ide__rename", "plan", hub)).be.undefined()
	})

	it("asks for a session rebuild when a hidden tool becomes available", async () => {
		const clock = sandbox.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

		await hub.setPlanModeAccess("ide", true, ["rename"])
		clock.tick(1000)

		should(toolListChanged.calledOnce).be.true()
	})

	it("does not rebuild the session for a tool Plan mode already offers", async () => {
		const clock = sandbox.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

		await hub.setPlanModeAccess("ide", true, ["run"])
		clock.tick(1000)

		should(toolListChanged.called).be.false()
	})

	it("reports the override with its scope", async () => {
		await hub.setPlanModeAccess("ide", true, ["run"])
		await hub.setPlanModeAccess("ide", false)

		should(captureOverride.args).deepEqual([
			["ide", "tool", true],
			["ide", "server", false],
		])
	})

	it("applies an override another window saved for a different server just before", async () => {
		const other = {
			name: "other",
			config: JSON.stringify({ type: "stdio", command: "other", allowAllInPlanMode: true }),
			status: "connected",
			allowAllInPlanMode: true,
			tools: [{ name: "write" }],
		}
		;(hub as any).connections.push({ server: other })
		should(getPlanModeApproval("other__write", "plan", hub)).be.undefined()

		// The settings file has no server-wide allow for `other`: it was revoked elsewhere.
		await hub.setPlanModeAccess("ide", true, ["run"])

		should(other.allowAllInPlanMode).be.false()
		should(getPlanModeApproval("other__write", "plan", hub)).equal("ask")
	})

	it("rejects a server that is not in the settings file", async () => {
		await should(hub.setPlanModeAccess("missing", true, ["run"])).be.rejectedWith(/not in the settings file/)
		should(captureOverride.called).be.false()
	})
})

// The settings file holds the overrides. These paths copy them onto the
// in-memory server without going through setPlanModeAccess.
describe("McpHub Plan-mode overrides read from the settings file", () => {
	let tempDir: string
	let settingsPath: string
	let hub: McpHub
	let notifyWebview: sinon.SinonStub
	const ideEntry = { type: "stdio", command: "ide", timeout: 60 }

	const connect = (storedOverrides: object = {}) => {
		const connection = {
			server: {
				name: "ide",
				config: JSON.stringify({ ...ideEntry, ...storedOverrides }),
				status: "connected",
				tools: [] as { name: string; allowInPlanMode?: boolean }[],
				allowAllInPlanMode: undefined as boolean | undefined,
			},
			client: {},
		}
		;(hub as any).connections = [connection]
		return connection.server
	}
	const saveOverrides = (overrides: object) =>
		fs.writeFile(settingsPath, JSON.stringify({ mcpServers: { ide: { ...ideEntry, ...overrides } } }))
	const allowedTools = (server: { tools: { name: string; allowInPlanMode?: boolean }[] }) =>
		server.tools.filter((tool) => tool.allowInPlanMode).map((tool) => tool.name)

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `mcp-plan-mode-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		getMcpSettingsFilePathStub.resolves(settingsPath)

		notifyWebview = sinon.stub().resolves()
		hub = Object.create(McpHub.prototype) as McpHub
		Object.assign(hub as any, {
			getSettingsDirectoryPath: async () => tempDir,
			fetchToolsList: async () => [{ name: "rename" }, { name: "run" }],
			fetchResourcesList: async () => [],
			fetchResourceTemplatesList: async () => [],
			fetchPromptsList: async () => [],
			notifyWebviewOfServerChanges: notifyWebview,
			removeAllFileWatchers: () => {},
		})
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("drops a revoked server-wide allow when a connection reopens with the config it first had", async () => {
		await saveOverrides({ allowInPlanMode: ["run"] })
		const server = connect({ allowAllInPlanMode: true })

		await (hub as any).fetchServerCapabilities((hub as any).connections[0])

		should(server.allowAllInPlanMode).be.false()
		should(allowedTools(server)).deepEqual(["run"])
		should(JSON.parse(server.config)).containDeep({ allowAllInPlanMode: false, allowInPlanMode: ["run"] })
	})

	it("picks up an allow saved after the connection's config was captured", async () => {
		await saveOverrides({ allowAllInPlanMode: true })
		const server = connect()

		await (hub as any).fetchServerCapabilities((hub as any).connections[0])

		should(server.allowAllInPlanMode).be.true()
	})

	it("allows nothing when the saved overrides are malformed or the file cannot be read", async () => {
		await saveOverrides({ allowInPlanMode: "run", allowAllInPlanMode: "yes" })
		const server = connect()
		await (hub as any).fetchServerCapabilities((hub as any).connections[0])
		should(server.allowAllInPlanMode).be.false()
		should(allowedTools(server)).deepEqual([])

		await fs.writeFile(settingsPath, "{ not json")
		const unreadable = connect({ allowAllInPlanMode: true })
		await (hub as any).fetchServerCapabilities((hub as any).connections[0])
		should(unreadable.allowAllInPlanMode).be.false()
	})

	it("keeps a tool's override when the server sends a new tool list", async () => {
		const server = connect({ allowInPlanMode: ["run"] })

		await (hub as any).refreshChangedList("ide", "tools", () => false)

		should(allowedTools(server)).deepEqual(["run"])
	})

	it("shows an override saved outside this window, and lets the session pick it up", async () => {
		const server = connect()
		server.tools = [{ name: "run" }]

		await hub.updateServerConnections({ ide: { ...ideEntry, allowAllInPlanMode: true } } as never)

		should(server.allowAllInPlanMode).be.true()
		should(notifyWebview.calledOnce).be.true()
	})

	it("stays quiet when a settings change leaves the overrides as they were", async () => {
		const server = connect({ allowInPlanMode: ["run"] })
		server.tools = [{ name: "run" }]

		await hub.updateServerConnections({ ide: { ...ideEntry, allowInPlanMode: ["run"], autoApprove: ["run"] } } as never)

		should(notifyWebview.called).be.false()
	})
})
