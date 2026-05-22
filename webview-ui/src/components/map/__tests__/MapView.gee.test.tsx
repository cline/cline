import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("MapView GEE toolbar removal", () => {
	it("MapView source does not mount GeeToolbar", () => {
		const src = readFileSync(resolve(__dirname, "../MapView.tsx"), "utf8")
		expect(src).not.toMatch(/GeeToolbar/)
		expect(src).not.toContain("Connect GEE")
	})

	it("GeeToolbar component file was removed from map", () => {
		let exists = true
		try {
			readFileSync(resolve(__dirname, "../GeeToolbar.tsx"), "utf8")
		} catch {
			exists = false
		}
		expect(exists).toBe(false)
	})
})

describe("MapToolRibbon geemap labels", () => {
	it("uses geemap-inspired aria labels in source", () => {
		const src = readFileSync(resolve(__dirname, "../MapToolRibbon.tsx"), "utf8")
		expect(src).toContain("Layer manager")
		expect(src).toContain("Export snapshot")
	})
})
