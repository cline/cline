function createStub(path) {
	return new Proxy(function () {}, {
		get: (target, prop) => {
			const fullPath = `${path}.${String(prop)}`
			console.log(`Accessed stub: ${fullPath}`)
			return createStub(fullPath)
		},
		apply: (target, thisArg, args) => {
			console.log(`Called stub: ${path} with args:`, args)
			return createStub(path)
		},
		construct: (target, args) => {
			console.log(`Constructed stub: ${path} with args:`, args)
			return createStub(path)
		},
	})
}

function stubUri(path) {
	console.log(`Using file path: ${path}`)
	return { fsPath: path }
}

function createMemento() {
	const store = {}
	return {
		get: (key, defaultValue) => (key in store ? store[key] : defaultValue),
		update: (key, value) => {
			store[key] = value
			return Promise.resolve()
		},
		keys: () => Object.keys(store),
	}
}

module.exports = { createStub, stubUri, createMemento }
