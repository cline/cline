import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("Map Plate Composer contract", () => {
	const src = readFileSync(resolve(__dirname, "../MapExport.tsx"), "utf8")

	it("separates quick export from research plate export", () => {
		expect(src).toContain("Quick Export")
		expect(src).toContain("Research Plate Export")
		expect(src).toContain("ExportReadinessReport")
	})

	it("uses extension-host persistence before emitting successful artifacts", () => {
		expect(src).toContain("prepareMapExport")
		expect(src).toContain("saveMapExport")
		expect(src).toContain("map_export.started")
		expect(src).not.toContain('document.createElement("a")')
	})

	it("records provenance for render limits and attribution", () => {
		expect(src).toContain("base64DataUrlUsed: false")
		expect(src).toContain("requiresVisibleAttribution")
		expect(src).toContain("CAPTURE_ONLY_LAYERS")
		expect(src).toContain("MAX_EXPORT_PIXELS")
	})
})
