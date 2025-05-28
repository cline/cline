// npx vitest run src/__tests__/cjs-import.test.ts

import { resolve } from "path"

describe("CommonJS Import Tests", () => {
	const packageRoot = resolve(__dirname, "../..")
	const cjsPath = resolve(packageRoot, "dist", "index.js")

	it("should import types using require() syntax", () => {
		// Clear require cache to ensure fresh import.
		delete require.cache[cjsPath]

		// Use require to test CJS functionality.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const module = require(cjsPath)

		// Verify that key exports are available
		expect(module.GLOBAL_STATE_KEYS).toBeDefined()
		expect(Array.isArray(module.GLOBAL_STATE_KEYS)).toBe(true)
		expect(module.GLOBAL_STATE_KEYS.length).toBeGreaterThan(0)
	})

	it("should import specific exports using destructuring", () => {
		// Clear require cache.
		delete require.cache[cjsPath]

		// Test destructured require.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { GLOBAL_STATE_KEYS, SECRET_STATE_KEYS } = require(cjsPath)

		expect(GLOBAL_STATE_KEYS).toBeDefined()
		expect(SECRET_STATE_KEYS).toBeDefined()
		expect(Array.isArray(GLOBAL_STATE_KEYS)).toBe(true)
		expect(Array.isArray(SECRET_STATE_KEYS)).toBe(true)
	})

	it("should have default export available", () => {
		// Clear require cache
		delete require.cache[cjsPath]

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const module = require(cjsPath)

		// Check if module has expected structure
		expect(typeof module).toBe("object")
		expect(module).not.toBeNull()
	})

	it("should maintain consistency between multiple require calls", () => {
		// Clear require cache first.
		delete require.cache[cjsPath]

		// Multiple require calls should return the same cached module.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const firstRequire = require(cjsPath)

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const secondRequire = require(cjsPath)

		// Should be the exact same object (cached).
		expect(firstRequire).toBe(secondRequire)
		expect(firstRequire.GLOBAL_STATE_KEYS).toBe(secondRequire.GLOBAL_STATE_KEYS)
	})
})
