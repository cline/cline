function createStub(path) {
	return new Proxy(function () {}, {
		get: (target, prop) => {
			const fullPath = `${path}.${String(prop)}`

			return createStub(fullPath)
		},
		apply: (target, thisArg, args) => {
			return createStub(path)
		},
		construct: (target, args) => {
			return createStub(path)
		},
	})
}

module.exports = { createStub }
