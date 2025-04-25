export class McpHub {
	connections = []
	isConnecting = false

	constructor() {
		this.toggleToolAlwaysAllow = jest.fn()
		this.callTool = jest.fn()
	}

	async toggleToolAlwaysAllow(_serverName: string, _toolName: string, _shouldAllow: boolean): Promise<void> {
		return Promise.resolve()
	}

	async callTool(_serverName: string, _toolName: string, _toolArguments?: Record<string, unknown>): Promise<any> {
		return Promise.resolve({ result: "success" })
	}
}
