export class McpHub {
	connections = []
	isConnecting = false

	constructor() {
		this.toggleToolAlwaysAllow = jest.fn()
		this.callTool = jest.fn()
	}

	async toggleToolAlwaysAllow(serverName: string, toolName: string, shouldAllow: boolean): Promise<void> {
		return Promise.resolve()
	}

	async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<any> {
		return Promise.resolve({ result: "success" })
	}
}
