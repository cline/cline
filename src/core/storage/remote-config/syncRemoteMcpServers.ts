import { getMcpSettingsFilePath } from "@core/storage/disk"
import { RemoteMCPServer } from "@shared/remote-config/schema"
import * as fs from "fs/promises"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"

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

		// Set flag to prevent watcher from triggering
		if (mcpHub) {
			mcpHub.setIsUpdatingFromRemoteConfig(true)
		}

		try {
			// Write back to file
			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))
		} finally {
			// Always clear flag, even if write fails
			if (mcpHub) {
				mcpHub.setIsUpdatingFromRemoteConfig(false)
			}
		}
	} catch (error) {
		Logger.error("[RemoteConfig] Failed to sync remote MCP servers:", error)
	}
}
