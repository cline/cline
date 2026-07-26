import type { ClineMcpServer } from "./cline-mcp-server"
import type { McpServerState } from "@shared/ExtensionMessage"

let activeMcpServer: ClineMcpServer | null = null

export function setActiveMcpServer(server: ClineMcpServer | null): void {
	activeMcpServer = server
}

export function getActiveMcpServer(): ClineMcpServer | null {
	return activeMcpServer
}

export function getMcpServerState(): McpServerState {
	if (activeMcpServer && activeMcpServer.listening) {
		return {
			active: true,
			port: activeMcpServer.getPort,
			publicUrl: activeMcpServer.getPublicUrl(),
		}
	}
	return {
		active: false,
		port: 3000,
	}
}
