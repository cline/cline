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

module.exports = { createStub }
