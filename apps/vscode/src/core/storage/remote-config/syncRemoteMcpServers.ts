import { getMcpSettingsFilePath } from "@core/storage/disk"
import { RemoteMCPServer } from "@shared/remote-config/schema"
import type { McpHub } from "@/services/mcp/McpHub"
import { updateMcpSettingsFile } from "@/services/mcp/settingsLock"
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

		// Hold the cross-process lock across the whole read-modify-write so a
		// concurrent writer (CLI, another window, an OAuth handshake) cannot drop
		// this sync's changes from a stale snapshot. Only writers need the lock;
		// reads rely on atomic rename to always see a complete file.
		const config = await updateMcpSettingsFile(settingsPath, (current) => {
			const config = current as Record<string, any>
			const servers = config.mcpServers as Record<string, any>

			// Remove servers marked as remoteConfigured that are no longer in the new remote config list.
			// This uses the persistent `remoteConfigured` marker in the settings file instead of
			// in-memory state, so it works correctly across extension restarts.
			for (const [serverName, serverConfig] of Object.entries(servers)) {
				const server = serverConfig as Record<string, unknown>
				if (server.remoteConfigured === true) {
					const stillInRemoteConfig = remoteMCPServers.some(
						(remoteServer) => remoteServer.name === serverName && remoteServer.url === server.url,
					)
					if (!stillInRemoteConfig) {
						delete servers[serverName]
					}
				}
			}

			// Add/update servers from new remote config
			for (const server of remoteMCPServers) {
				// Check if server with same name and URL already exists to skip duplicates
				const existingServer = servers[server.name]
				if (existingServer && existingServer.url === server.url) {
					if (!existingServer.remoteConfigured) {
						existingServer.remoteConfigured = true
					}
					continue
				}

				// Add or update the server with remoteConfigured marker
				servers[server.name] = {
					url: server.url,
					type: "streamableHttp",
					disabled: false,
					autoApprove: [],
					remoteConfigured: true,
				}
			}
			config.mcpServers = servers
			return config
		})
		if (mcpHub) {
			mcpHub.recordSettingsFingerprint(config.mcpServers)
		}
	} catch (error) {
		Logger.error("[RemoteConfig] Failed to sync remote MCP servers:", error)
	}
}
