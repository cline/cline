import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "mocha"
import should from "should"

const packagePath = path.resolve(process.cwd(), "package.json")

async function readPackageJson(): Promise<any> {
	return JSON.parse(await readFile(packagePath, "utf8"))
}

describe("AI-Hydro map VS Code contributions", () => {
	it("registers file-first map commands in menus and command palette", async () => {
		const packageJson = await readPackageJson()
		const commands = new Set(packageJson.contributes.commands.map((entry: { command: string }) => entry.command))
		const commandPalette = new Set(
			packageJson.contributes.menus.commandPalette.map((entry: { command: string }) => entry.command),
		)

		for (const command of [
			"aihydro.addFileToMap",
			"aihydro.map.addLayerFromUrl",
			"aihydro.map.gallery",
			"aihydro.map.saveScene",
			"aihydro.map.openScene",
		]) {
			commands.has(command).should.equal(true, `${command} should be contributed`)
		}

		for (const command of [
			"aihydro.map.addLayerFromUrl",
			"aihydro.map.gallery",
			"aihydro.map.saveScene",
			"aihydro.map.openScene",
		]) {
			commandPalette.has(command).should.equal(true, `${command} should appear in the command palette`)
		}
	})

	it("exposes Add to AI-Hydro Map from editor titles and explorer context", async () => {
		const packageJson = await readPackageJson()
		const menus = packageJson.contributes.menus

		for (const menuId of ["explorer/context", "editor/title", "editor/title/context"]) {
			const entries = menus[menuId] as Array<{ command: string; when?: string }>
			const addEntry = entries.find((entry) => entry.command === "aihydro.addFileToMap")
			should.exist(addEntry, `${menuId} should include Add to AI-Hydro Map`)
			addEntry?.when?.should.containEql("resourceExtname == .geojson")
			addEntry?.when?.should.containEql("resourceExtname == .tif")
			addEntry?.when?.should.containEql("resourceExtname == .csv")
		}
	})

	it("declares common geospatial file associations and GeoJSON validation", async () => {
		const packageJson = await readPackageJson()
		const languageExtensions = new Set(
			packageJson.contributes.languages.flatMap((language: { extensions: string[] }) => language.extensions),
		)

		for (const extension of [".geojson", ".topojson", ".kml", ".kmz", ".gpx", ".zip", ".tif", ".tiff"]) {
			languageExtensions.has(extension).should.equal(true, `${extension} should be associated with AI-Hydro map`)
		}

		const geojsonValidation = packageJson.contributes.jsonValidation.find((entry: { fileMatch: string[] }) =>
			entry.fileMatch.includes("*.geojson"),
		)
		should.exist(geojsonValidation)
		geojsonValidation.url.should.equal("https://geojson.org/schema/GeoJSON.json")
	})

	it("adds a keyboard shortcut for active geospatial files", async () => {
		const packageJson = await readPackageJson()
		const keybinding = packageJson.contributes.keybindings.find(
			(entry: { command: string }) => entry.command === "aihydro.addFileToMap",
		)

		should.exist(keybinding)
		keybinding.key.should.equal("cmd+alt+m")
		keybinding.mac.should.equal("cmd+alt+m")
		keybinding.when.should.containEql("resourceExtname == .geojson")
		keybinding.when.should.containEql("resourceExtname == .tif")
	})

	it("keeps Research Gallery as a secondary discovery command", async () => {
		const packageJson = await readPackageJson()
		const galleryCommand = packageJson.contributes.commands.find(
			(entry: { command: string }) => entry.command === "aihydro.map.gallery",
		)

		should.exist(galleryCommand)
		galleryCommand.title.should.equal("AI-Hydro Map: Open Research Gallery")
	})
})
