import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "mocha"
import "should"

const layerPanelPath = path.resolve(process.cwd(), "webview-ui/src/components/map/LayerPanel.tsx")
const ribbonPath = path.resolve(process.cwd(), "webview-ui/src/components/map/MapToolRibbon.tsx")
const configPath = path.resolve(process.cwd(), "src/config.ts")
const mapProviderPath = path.resolve(process.cwd(), "src/hosts/vscode/VscodeMapPanelProvider.ts")
const galleryPanelPath = path.resolve(process.cwd(), "webview-ui/src/components/map/ResearchGalleryPanel.tsx")

describe("AI-Hydro Research Gallery placement", () => {
	it("does not expose Research Gallery as a primary layer toolbar action", async () => {
		const source = await readFile(layerPanelPath, "utf8")

		source.should.not.containEql("aihydro-map-gallery-command")
		source.should.not.containEql("Gallery")
	})

	it("exposes Research Gallery as a visible map ribbon tool", async () => {
		const source = await readFile(ribbonPath, "utf8")

		source.should.containEql('"gallery"')
		source.should.containEql("Research Gallery")
		source.should.containEql("ResearchGalleryPanel")
	})

	it("configures the canonical AI-Hydro Gallery catalog endpoint", async () => {
		const source = await readFile(configPath, "utf8")
		const mapProvider = await readFile(mapProviderPath, "utf8")

		source.should.containEql("researchGalleryBaseUrl")
		source.should.containEql("AI_HYDRO_RESEARCH_GALLERY_BASE_URL")
		source.should.containEql("https://ai-hydro.github.io/Gallery/api")
		mapProvider.should.containEql("https://raw.githubusercontent.com/AI-Hydro/Gallery/main/api/gallery.json")
	})

	it("surfaces the public Gallery contribution path in the panel", async () => {
		const source = await readFile(galleryPanelPath, "utf8")

		source.should.containEql("Contribute a Gallery item?")
		source.should.containEql("https://github.com/AI-Hydro/Gallery/issues/new?template=new_gallery_item.md")
		source.should.containEql("Open contribution template on GitHub")
	})
})
