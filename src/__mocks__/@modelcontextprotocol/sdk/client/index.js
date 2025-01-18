class Client {
	constructor() {
		this.request = jest.fn()
	}

	connect() {
		return Promise.resolve()
	}

	close() {
		return Promise.resolve()
	}
}

module.exports = {
	Client,
}
