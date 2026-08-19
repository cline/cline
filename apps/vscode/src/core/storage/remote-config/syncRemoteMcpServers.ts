import { RemoteMCPServer } from "@shared/remote-config/schema"
import { updateMcpSettingsFile } from "@/services/mcp/settingsLock"
import { Logger } from "@/shared/services/Logger"

type McpSettingsFingerprintRecorder = {
	recordSettingsFingerprint(servers: Record<string, unknown>): void
}

function getConfiguredServerUrl(server: Record<string, unknown>): string | undefined {
	if (typeof server.url === "string") {
		return server.url
	}
	const transport = server.transport
	if (transport && typeof transport === "object" && !Array.isArray(transport)) {
		const url = (transport as Record<string, unknown>).url
		return typeof url === "string" ? url : undefined
	}
	return undefined
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
 * @param settingsPath Path to the MCP settings file
 * @param mcpHub Optional McpHub instance to set flag preventing watcher triggers
 */
export async function syncRemoteMcpServersToSettings(
	remoteMCPServers: RemoteMCPServer[],
	settingsPath: string,
	mcpHub?: McpSettingsFingerprintRecorder,
): Promise<void> {
	try {
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
					const configuredUrl = getConfiguredServerUrl(server)
					const stillInRemoteConfig = remoteMCPServers.some(
						(remoteServer) => remoteServer.name === serverName && remoteServer.url === configuredUrl,
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
				if (existingServer && getConfiguredServerUrl(existingServer) === server.url) {
					if (!existingServer.remoteConfigured) {
						existingServer.remoteConfigured = true
					}
					// Keep the historical top-level URL field for remote-configured
					// servers so older sync/UI code can identify the managed server
					// without needing to understand nested SDK transport shape.
					if (!existingServer.url) {
						existingServer.url = server.url
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
