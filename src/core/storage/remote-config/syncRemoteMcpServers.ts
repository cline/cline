import { getMcpSettingsFilePath } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { RemoteMCPServer } from "@shared/remote-config/schema"
import * as fs from "fs/promises"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"

/**
 * Synchronizes remote MCP servers from remote config to the local MCP settings file
 * This allows admins to centrally configure MCP servers that are automatically deployed to users
 *
 * Handles:
 * - Removing servers that were previously from remote config but are no longer present
 * - Adding new servers from remote config
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

		// Get previous remote servers from cache
		const stateManager = StateManager.get()
		const previousRemoteServers = (stateManager.getRemoteConfigSettings().previousRemoteMCPServers as RemoteMCPServer[]) || []

		// Remove old remote servers that are no longer in the new list
		for (const prevServer of previousRemoteServers) {
			// Check if this server exists in current settings with same name and URL
			const existingServer = config.mcpServers[prevServer.name]
			if (existingServer && existingServer.url === prevServer.url) {
				// Check if it's still in the new remote config
				const stillInRemoteConfig = remoteMCPServers.some(
					(newServer) => newServer.name === prevServer.name && newServer.url === prevServer.url,
				)
				if (!stillInRemoteConfig) {
					// Remove it from settings
					delete config.mcpServers[prevServer.name]
				}
			}
		}

		// Add/update servers from new remote config
		for (const server of remoteMCPServers) {
			// Check if server with same name and URL already exists to skip duplicates
			const existingServer = config.mcpServers[server.name]
			if (existingServer && existingServer.url === server.url) {
				continue
			}

			// Add or update the server
			config.mcpServers[server.name] = {
				url: server.url,
				type: "streamableHttp",
				disabled: false,
				autoApprove: [],
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
