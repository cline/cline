import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { getBoundStudy } from "../boundStudy"

// Locks in the cross-language file contract with the Python session layer
// (ai_hydro.session.chat_binding writes chat_studies.json; ai_hydro.session.store
// writes sessions/<id>.json). If either format drifts, these break loudly instead
// of the chip silently going blank.
describe("getBoundStudy", () => {
	let home: string

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-home-"))
		fs.mkdirSync(path.join(home, "sessions"), { recursive: true })
	})

	afterEach(() => {
		fs.rmSync(home, { recursive: true, force: true })
	})

	const writeBindings = (chatToStudy: Record<string, string>) => {
		fs.writeFileSync(
			path.join(home, "chat_studies.json"),
			JSON.stringify({ chat_to_study: chatToStudy, study_to_chat: {}, meta: {} }),
		)
	}

	it("returns undefined for a missing ulid", () => {
		expect(getBoundStudy(undefined, home)).to.equal(undefined)
	})

	it("returns undefined when the binding file is absent", () => {
		expect(getBoundStudy("ulid-x", home)).to.equal(undefined)
	})

	it("returns undefined when the ulid is not bound", () => {
		writeBindings({ "other-ulid": "01547700" })
		expect(getBoundStudy("ulid-x", home)).to.equal(undefined)
	})

	it("resolves studyId when bound but no session file exists", () => {
		writeBindings({ "ulid-x": "01547700" })
		expect(getBoundStudy("ulid-x", home)).to.deep.equal({ studyId: "01547700" })
	})

	it("enriches with site_name from the session file", () => {
		writeBindings({ "ulid-x": "01547700" })
		fs.writeFileSync(
			path.join(home, "sessions", "01547700.json"),
			JSON.stringify({ session_id: "01547700", site_name: "Marsh Creek At Blanchard, PA" }),
		)
		expect(getBoundStudy("ulid-x", home)).to.deep.equal({
			studyId: "01547700",
			siteName: "Marsh Creek At Blanchard, PA",
		})
	})

	it("falls back to studyId-only when the binding file is corrupt", () => {
		fs.writeFileSync(path.join(home, "chat_studies.json"), "{ not valid json")
		expect(getBoundStudy("ulid-x", home)).to.equal(undefined)
	})

	it("ignores a blank site_name", () => {
		writeBindings({ "ulid-x": "03092460" })
		fs.writeFileSync(
			path.join(home, "sessions", "03092460.json"),
			JSON.stringify({ session_id: "03092460", site_name: "   " }),
		)
		expect(getBoundStudy("ulid-x", home)).to.deep.equal({ studyId: "03092460" })
	})
})
