class StdioClientTransport {
	constructor() {
		this.start = jest.fn().mockResolvedValue(undefined)
		this.close = jest.fn().mockResolvedValue(undefined)
		this.stderr = {
			on: jest.fn(),
		}
	}
}

class StdioServerParameters {
	constructor() {
		this.command = ""
		this.args = []
		this.env = {}
	}
}

module.exports = {
	StdioClientTransport,
	StdioServerParameters,
}
