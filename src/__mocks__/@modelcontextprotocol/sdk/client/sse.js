class SSEClientTransport {
	constructor(url, options = {}) {
		this.url = url
		this.options = options
		this.onerror = null
		this.connect = jest.fn().mockResolvedValue()
		this.close = jest.fn().mockResolvedValue()
		this.start = jest.fn().mockResolvedValue()
	}
}

module.exports = {
	SSEClientTransport,
}
