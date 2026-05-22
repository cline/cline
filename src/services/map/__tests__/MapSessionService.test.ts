import { MapRoi } from "@shared/proto/cline/map"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { MapSessionService } from "../MapSessionService"

describe("MapSessionService", () => {
	const tmpRoots: string[] = []

	afterEach(async () => {
		for (const root of tmpRoots) {
			await fs.rm(root, { recursive: true, force: true })
		}
		tmpRoots.length = 0
	})

	it("setActiveRoi and clearActiveRoi update snapshot", () => {
		const svc = new MapSessionService("/tmp/ws")
		svc.setActiveRoi(
			MapRoi.create({
				id: "r1",
				name: "Test basin",
				source: "map_draw",
				geojson: '{"type":"FeatureCollection","features":[]}',
				areaHa: 100,
				workspacePath: "",
			}),
			"user",
		)
		expect(svc.getActiveRoi()?.name).to.equal("Test basin")
		svc.clearActiveRoi("user")
		expect(svc.getActiveRoi()).to.be.undefined
	})

	it("appendEvent keeps ring buffer capped", () => {
		const svc = new MapSessionService()
		for (let i = 0; i < 105; i++) {
			svc.appendEvent({
				type: "view.changed",
				payloadJson: `{"i":${i}}`,
				timestampMs: i,
				source: "user",
			})
		}
		const recent = svc.getRecentEvents(200)
		expect(recent.length).to.be.at.most(100)
		expect(recent[recent.length - 1]?.timestampMs).to.equal(104)
	})

	it("saveRoiToWorkspace writes roi files and active pointer", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-"))
		tmpRoots.push(root)
		const svc = new MapSessionService(root)
		svc.setActiveRoi(
			MapRoi.create({
				id: "penobscot",
				name: "Penobscot",
				source: "map_draw",
				geojson: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
				areaHa: 12400,
				workspacePath: "",
			}),
		)
		const result = await svc.saveRoiToWorkspace("Penobscot basin")
		expect(result.workspacePath).to.equal("roi/penobscot_basin.geojson")
		const pointer = JSON.parse(await fs.readFile(path.join(root, "roi", "active.json"), "utf8"))
		expect(pointer.path).to.equal("roi/penobscot_basin.geojson")
		const geo = await fs.readFile(path.join(root, result.workspacePath), "utf8")
		expect(geo).to.include("Polygon")
	})

	it("loadRoiFromWorkspace hydrates active ROI from active.json", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "map-session-load-"))
		tmpRoots.push(root)
		await fs.mkdir(path.join(root, "roi"), { recursive: true })
		const rel = "roi/saved_basin.geojson"
		await fs.writeFile(
			path.join(root, rel),
			'{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}',
		)
		await fs.writeFile(path.join(root, "roi", "active.json"), JSON.stringify({ path: rel, name: "Saved basin" }))
		const svc = new MapSessionService(root)
		const loaded = await svc.loadRoiFromWorkspace()
		expect(loaded.workspacePath).to.equal(rel)
		expect(svc.getActiveRoi()?.source).to.equal("workspace")
	})
})
