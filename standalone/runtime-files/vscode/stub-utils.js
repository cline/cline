function createStub(path) {
	return new Proxy(() => {}, {
		get: (_target, prop) => {
			const fullPath = `${path}.${String(prop)}`
			console.log(`Accessed stub: ${fullPath}`)
			return createStub(fullPath)
		},
		apply: (_target, _thisArg, args) => {
			console.log(`Called stub: ${path} with args:`, args)
			return createStub(path)
		},
		construct: (_target, args) => {
			console.log(`Constructed stub: ${path} with args:`, args)
			return createStub(path)
		},
	})
}

module.exports = { createStub }
