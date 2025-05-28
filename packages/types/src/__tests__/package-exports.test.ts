// npx vitest run src/__tests__/package-exports.test.ts

import { resolve } from "path"

describe("Package Exports Integration Tests", () => {
	const packageRoot = resolve(__dirname, "../..")
	const distPath = resolve(packageRoot, "dist")

	it("should import from built ESM file", async () => {
		const esmPath = resolve(distPath, "index.mjs")

		// Dynamic import of the built ESM file
		const module = await import(esmPath)

		expect(module.GLOBAL_STATE_KEYS).toBeDefined()
		expect(Array.isArray(module.GLOBAL_STATE_KEYS)).toBe(true)
		expect(module.GLOBAL_STATE_KEYS.length).toBeGreaterThan(0)
	})

	it("should import from built CJS file", () => {
		const cjsPath = resolve(distPath, "index.js")

		// Clear require cache to ensure fresh import
		delete require.cache[cjsPath]

		// Require the built CJS file
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const module = require(cjsPath)

		expect(module.GLOBAL_STATE_KEYS).toBeDefined()
		expect(Array.isArray(module.GLOBAL_STATE_KEYS)).toBe(true)
		expect(module.GLOBAL_STATE_KEYS.length).toBeGreaterThan(0)
	})

	it("should have consistent exports between ESM and CJS builds", async () => {
		const esmPath = resolve(distPath, "index.mjs")
		const cjsPath = resolve(distPath, "index.js")

		// Clear require cache.
		delete require.cache[cjsPath]

		// Import both versions.
		const esmModule = await import(esmPath)
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cjsModule = require(cjsPath)

		// Compare key exports.
		expect(esmModule.GLOBAL_STATE_KEYS).toEqual(cjsModule.GLOBAL_STATE_KEYS)
		expect(esmModule.SECRET_STATE_KEYS).toEqual(cjsModule.SECRET_STATE_KEYS)

		// Ensure both have the same export keys.
		const esmKeys = Object.keys(esmModule).sort()
		const cjsKeys = Object.keys(cjsModule).sort()
		expect(esmKeys).toEqual(cjsKeys)
	})

	it("should import using package name resolution (simulated)", async () => {
		// This simulates how the package would be imported by consumers.
		// We test the source files since we can't easily test the published package.
		const module = await import("../index.js")

		// Verify the main exports that consumers would use.
		expect(module.GLOBAL_STATE_KEYS).toBeDefined()
		expect(module.SECRET_STATE_KEYS).toBeDefined()

		// Test some common type exports exist.
		expect(typeof module.GLOBAL_STATE_KEYS).toBe("object")
		expect(typeof module.SECRET_STATE_KEYS).toBe("object")
	})

	it("should have TypeScript definitions available", () => {
		const dtsPath = resolve(distPath, "index.d.ts")
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("fs")

		// Check that the .d.ts file exists and has content.
		expect(fs.existsSync(dtsPath)).toBe(true)

		const dtsContent = fs.readFileSync(dtsPath, "utf8")
		expect(dtsContent.length).toBeGreaterThan(0)
		expect(dtsContent).toContain("export")
	})
})
