// npx vitest run src/__tests__/esm-import.test.ts

describe("ESM Import Tests", () => {
	it("should import types using ESM syntax", async () => {
		// Dynamic import to test ESM functionality.
		const module = await import("../index.js")

		// Verify that key exports are available.
		expect(module.GLOBAL_STATE_KEYS).toBeDefined()
		expect(Array.isArray(module.GLOBAL_STATE_KEYS)).toBe(true)
		expect(module.GLOBAL_STATE_KEYS.length).toBeGreaterThan(0)
	})

	it("should import specific exports using ESM syntax", async () => {
		// Test named imports.
		const { GLOBAL_STATE_KEYS, SECRET_STATE_KEYS } = await import("../index.js")

		expect(GLOBAL_STATE_KEYS).toBeDefined()
		expect(SECRET_STATE_KEYS).toBeDefined()
		expect(Array.isArray(GLOBAL_STATE_KEYS)).toBe(true)
		expect(Array.isArray(SECRET_STATE_KEYS)).toBe(true)
	})

	it("should have consistent exports between static and dynamic imports", async () => {
		// Static import.
		const staticImport = await import("../index.js")

		// Dynamic import.
		const dynamicImport = await import("../index.js")

		// Both should have the same exports.
		expect(Object.keys(staticImport)).toEqual(Object.keys(dynamicImport))
		expect(staticImport.GLOBAL_STATE_KEYS).toEqual(dynamicImport.GLOBAL_STATE_KEYS)
	})
})
