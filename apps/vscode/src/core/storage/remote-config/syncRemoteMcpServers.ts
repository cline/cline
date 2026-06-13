import { getMcpSettingsFilePath } from "@core/storage/disk"
import { RemoteMCPServer } from "@shared/remote-config/schema"
import * as fs from "fs/promises"
import * as path from "path"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"

/**
 * Atomically write the MCP settings file via a temp file + rename, so a
 * concurrent reader (another window, the CLI, a watcher) never observes a
 * torn or empty file. Used as the fallback when no McpHub is available;
 * McpHub.writeSettingsFile does the same thing plus fingerprint bookkeeping.
 */
async function atomicWriteSettingsFile(settingsPath: string, contents: string): Promise<void> {
	const tempPath = `${settingsPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
	await fs.mkdir(path.dirname(settingsPath), { recursive: true })
	try {
		await fs.writeFile(tempPath, contents, { encoding: "utf-8", flag: "wx" })
		await fs.rename(tempPath, settingsPath)
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {})
		throw error
	}
}

/**
 * Synchronizes remote MCP servers from remote config to the local MCP settings file
 * This allows admins to centrally configure MCP servers that are automatically deployed to users
 *
 * Uses the `remoteConfigured: true` marker in the settings file to track which servers
 * were added by remote config. This survives extension restarts (unlike in-memory state)
 * and ensures proper cleanup when servers are removed from remote config.
 *
 * Handles:
 * - Removing servers marked as `remoteConfigured` that are no longer in the remote config
 * - Adding new servers from remote config with the `remoteConfigured` marker
 * - Preventing duplicates when re-adding servers
 *
 * @param remoteMCPServers Array of remote MCP servers from remote config
 * @param settingsDirectoryPath Path to the settings directory
 * @param mcpHub Optional McpHub instance to set flag preventing watcher triggers
 */
export async function syncRemoteMcpServersToSettings(
	remoteMCPServers: RemoteMCPServer[],
	settingsDirectoryPath: string,
	mcpHub?: McpHub,
): Promise<void> {
	try {
		// Get or create the MCP settings file
		const settingsPath = await getMcpSettingsFilePath(settingsDirectoryPath)

		// Read current settings
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)

		// Ensure mcpServers object exists
		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}

		// Remove servers marked as remoteConfigured that are no longer in the new remote config list.
		// This uses the persistent `remoteConfigured` marker in the settings file instead of
		// in-memory state, so it works correctly across extension restarts.
		for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
			const server = serverConfig as Record<string, unknown>
			if (server.remoteConfigured === true) {
				const stillInRemoteConfig = remoteMCPServers.some(
					(remoteServer) => remoteServer.name === serverName && remoteServer.url === server.url,
				)
				if (!stillInRemoteConfig) {
					delete config.mcpServers[serverName]
				}
			}
		}

		// Add/update servers from new remote config
		for (const server of remoteMCPServers) {
			// Check if server with same name and URL already exists to skip duplicates
			const existingServer = config.mcpServers[server.name]
			if (existingServer && existingServer.url === server.url) {
				if (!existingServer.remoteConfigured) {
					existingServer.remoteConfigured = true
				}
				continue
			}

			// Add or update the server with remoteConfigured marker
			config.mcpServers[server.name] = {
				url: server.url,
				type: "streamableHttp",
				disabled: false,
				autoApprove: [],
				remoteConfigured: true,
			}
		}

		// Write back atomically so a concurrent reader never sees a torn or empty
		// file. McpHub.writeSettingsFile also records the connection fingerprint
		// so its watcher treats this write as a no-op; without an McpHub we still
		// do an equivalent atomic temp+rename.
		const serialized = JSON.stringify(config, null, 2)
		if (mcpHub) {
			await mcpHub.writeSettingsFile(settingsPath, serialized, config.mcpServers)
		} else {
			await atomicWriteSettingsFile(settingsPath, serialized)
		}
	} catch (error) {
		Logger.error("[RemoteConfig] Failed to sync remote MCP servers:", error)
	}
}
