import { describe, expect, it, mock } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sinon from "sinon"
import { McpSettingsSchema, ServerConfigSchema } from "../schemas"
import type { McpServerConfig } from "../types"

type McpHubInstance = import("../McpHub").McpHub

mock.module("@core/controller/mcp/subscribeToMcpServers", () => ({ sendMcpServersUpdate: async () => {} }))
let mockSettingsPath = "/tmp/cline_mcp_settings.json"
mock.module("@core/storage/disk", () => ({ getMcpSettingsFilePath: async () => mockSettingsPath }))
mock.module("@core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getRemoteConfigSettings: () => ({}) }) },
}))
mock.module("@shared/proto-conversions/mcp/mcp-server-conversion", () => ({
	convertMcpServersToProtoMcpServers: () => [],
}))
mock.module("@/hosts/host-provider", () => ({
	HostProvider: { window: { showMessage: async () => ({}), showTextDocument: async () => {} } },
}))
mock.module("@/shared/net", () => ({ fetch: globalThis.fetch }))
mock.module("@/shared/proto/host/window", () => ({ ShowMessageType: { ERROR: "error" } }))
mock.module("@/shared/services/Logger", () => ({
	Logger: { log: () => {}, warn: () => {}, error: () => {} },
}))
mock.module("@/utils/env", () => ({ openExternal: async () => {} }))

const { McpHub } = await import("../McpHub")

function remoteConfig(accessToken?: string): McpServerConfig {
	return ServerConfigSchema.parse({
		type: "streamableHttp",
		url: "https://mcp.example.com/mcp",
		oauth: accessToken ? { tokens: { access_token: accessToken } } : {},
	})
}

function envReference(name: string): string {
	return ["$", "{env:", name, "}"].join("")
}

async function expectTokenPresenceChangeReconnects(oldToken: string | undefined, newToken: string | undefined) {
	const oldConfig = remoteConfig(oldToken)
	const newConfig = remoteConfig(newToken)
	const hub = Object.create(McpHub.prototype) as McpHubInstance
	;(hub as unknown as { connections: unknown[] }).connections = [
		{
			server: {
				name: "test",
				config: JSON.stringify({ type: "streamableHttp", url: "<redacted>" }),
				status: "connected",
				disabled: false,
				oauthAuthStatus: oldToken ? "authenticated" : "unauthenticated",
			},
			client: {},
			transport: {},
			configSnapshot: oldConfig,
		},
	]
	;(hub as unknown as { isConnecting: boolean }).isConnecting = false

	sinon.stub(hub as any, "removeAllFileWatchers")
	sinon.stub(hub as any, "checkToolListChanged")
	sinon.stub(hub as any, "notifyWebviewOfServerChanges").resolves()
	const deleteConnection = sinon.stub(hub as any, "deleteConnection").callsFake(async () => {
		;(hub as unknown as { connections: unknown[] }).connections = []
	})
	const connectToServer = sinon.stub(hub as any, "connectToServer").resolves()

	await hub.updateServerConnections({ test: newConfig })

	expect(deleteConnection.calledOnce).toBe(true)
	expect(connectToServer.calledOnce).toBe(true)
	expect(connectToServer.firstCall.args).toEqual(["test", newConfig, "internal"])
}

describe("McpHub OAuth token reconciliation", () => {
	it("closes and reconnects an authenticated session when its token disappears", async () => {
		await expectTokenPresenceChangeReconnects("persisted-token", undefined)
	})

	it("reconnects an unauthenticated server when a token appears", async () => {
		await expectTokenPresenceChangeReconnects(undefined, "new-token")
	})

	it("rereads auto-restored remote servers to preserve safe URL identity without exposing expansion", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "cline-mcp-remote-restore-"))
		const settingsPath = join(tempDir, "cline_mcp_settings.json")
		const previousSettingsPath = mockSettingsPath
		const environmentName = "CLINE_TEST_REMOTE_MCP_URL"
		const previousEnvironmentValue = process.env[environmentName]
		const safeUrl = "https://managed.example.com/mcp/"
		const expandedSecretUrl = "https://expanded-secret.example.com/private"
		const remoteServers = [
			{ name: "locked", url: safeUrl, alwaysEnabled: true },
			{ name: "expanded", url: envReference(environmentName), alwaysEnabled: true },
		]
		mockSettingsPath = settingsPath
		process.env[environmentName] = expandedSecretUrl
		await writeFile(settingsPath, JSON.stringify({ mcpServers: {} }), "utf8")

		try {
			const hub = Object.create(McpHub.prototype) as McpHubInstance
			;(hub as unknown as { getSettingsDirectoryPath: () => Promise<string> }).getSettingsDirectoryPath = async () =>
				tempDir
			const privateHub = hub as unknown as {
				restoreMissingRemoteConfiguredServers: (
					settings: ReturnType<typeof McpSettingsSchema.parse>,
					servers: readonly { name: string; url: string }[],
				) => Promise<ReturnType<typeof McpSettingsSchema.parse>>
				serializeConnectionConfig: (name: string, config: McpServerConfig) => string
			}

			const restored = await privateHub.restoreMissingRemoteConfiguredServers(
				McpSettingsSchema.parse({ mcpServers: {} }),
				remoteServers,
			)
			const lockedDisplay = JSON.parse(
				privateHub.serializeConnectionConfig("locked", restored.mcpServers.locked as McpServerConfig),
			)
			const expandedDisplay = privateHub.serializeConnectionConfig(
				"expanded",
				restored.mcpServers.expanded as McpServerConfig,
			)

			expect(lockedDisplay.url).toBe(safeUrl)
			expect(remoteServers.some((server) => server.alwaysEnabled && server.url === lockedDisplay.url)).toBe(true)
			expect(JSON.parse(expandedDisplay).url).toBe("<redacted>")
			expect(expandedDisplay).not.toContain("expanded-secret")
			const persisted = JSON.parse(await readFile(settingsPath, "utf8"))
			expect(persisted.mcpServers.expanded.url).toBe(envReference(environmentName))
		} finally {
			mockSettingsPath = previousSettingsPath
			if (previousEnvironmentValue === undefined) {
				delete process.env[environmentName]
			} else {
				process.env[environmentName] = previousEnvironmentValue
			}
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
