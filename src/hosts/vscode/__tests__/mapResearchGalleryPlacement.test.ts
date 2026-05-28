import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "mocha"
import "should"

const layerPanelPath = path.resolve(process.cwd(), "webview-ui/src/components/map/LayerPanel.tsx")

describe("AI-Hydro Research Gallery placement", () => {
	it("does not expose Research Gallery as a primary layer toolbar action", async () => {
		const source = await readFile(layerPanelPath, "utf8")

		source.should.not.containEql("aihydro-map-gallery-command")
		source.should.not.containEql("Gallery")
	})
})
