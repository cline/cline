import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { expect } from "chai"
import { canonicalJsonBytes } from "../canonicalJson"
import type { LearningPackManifest } from "../types"
import { validateLearningPackFiles } from "../validateLearningPack"

const MODULE_IDS = ["hmfp.orientation.00", "hmfp.water-balance.01"]

function moduleHtml(id: string, executable: boolean): Buffer {
	return Buffer.from(
		`<!doctype html><html><head><script type="application/vnd.aihydro.module+json">${JSON.stringify({
			id,
			title: id,
			version: "0.1.0",
			authors: [{ name: "Synthetic Test" }],
			license: "CC-BY-4.0",
			requires: { executable, python: executable ? ["matplotlib"] : [] },
		})}</script></head><body>${id}</body></html>`,
		"utf8",
	)
}

function createValidFiles(): { files: Map<string, Uint8Array>; fingerprint: string } {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519")
	const publicKeyDer = publicKey.export({ format: "der", type: "spki" })
	const fingerprint = `sha256:${createHash("sha256").update(publicKeyDer).digest("hex")}`
	const manifest: LearningPackManifest = {
		schemaVersion: 1,
		packId: "hmfp",
		version: "0.1.0",
		edition: "student",
		title: "Hydrologic Modeling from First Principles",
		license: "CC-BY-4.0",
		publisher: { name: "Synthetic Test", keyId: fingerprint },
		ownership: { courseId: "hmfp", moduleIds: MODULE_IDS },
		entryModuleId: MODULE_IDS[0],
		compatibility: { aiHydro: ">=0.2.5 <0.3.0", packApi: 1, runtimeContract: "html-preview-v1" },
		capabilities: { localPython: "terminal-equivalent", webExternalOrigins: [] },
		environmentPath: "environments/environment.json",
		provenancePath: "provenance/provenance.json",
	}
	const course = {
		courseId: "hmfp",
		title: "Synthetic Course",
		modules: MODULE_IDS.map((id) => ({ id, path: `modules/${id}/module.html`, title: id })),
	}
	const payload = new Map<string, Uint8Array>([
		["pack.json", canonicalJsonBytes(manifest)],
		["course.json", canonicalJsonBytes(course)],
		[`modules/${MODULE_IDS[0]}/module.html`, moduleHtml(MODULE_IDS[0], false)],
		[`modules/${MODULE_IDS[1]}/module.html`, moduleHtml(MODULE_IDS[1], true)],
		["environments/environment.json", canonicalJsonBytes({ python: ">=3.11" })],
		["provenance/provenance.json", canonicalJsonBytes({ buildKind: "development", sourceCommit: "a".repeat(40) })],
	])
	const entries = [...payload.entries()]
		.map(([path, value]) => ({ path, sha256: createHash("sha256").update(value).digest("hex"), size: value.byteLength }))
		.sort((a, b) => a.path.localeCompare(b.path))
	const checksumBytes = canonicalJsonBytes({ algorithm: "sha256", files: entries })
	const signatureBytes = sign(null, checksumBytes, privateKey)
	const files = new Map(payload)
	files.set("checksums.json", checksumBytes)
	files.set(
		"signatures/ed25519.json",
		canonicalJsonBytes({
			algorithm: "Ed25519",
			publicKeySpki: publicKeyDer.toString("base64"),
			signature: signatureBytes.toString("base64"),
		}),
	)
	return { files, fingerprint }
}

describe("validateLearningPackFiles", () => {
	it("validates canonical bytes, ownership, checksums, and the derived Ed25519 fingerprint", () => {
		const { files, fingerprint } = createValidFiles()
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("valid")
		expect(result.verified?.signerFingerprint).to.equal(fingerprint)
	})

	it("rejects duplicate JSON object keys before schema validation", () => {
		const { files } = createValidFiles()
		files.set("pack.json", Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n'))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("invalid")
		expect(result.diagnostics[0].code).to.equal("DUPLICATE_KEY")
	})

	it("rejects semantically valid but noncanonical JSON", () => {
		const { files } = createValidFiles()
		const pack = JSON.parse(Buffer.from(files.get("pack.json")!).toString("utf8"))
		files.set("pack.json", Buffer.from(`${JSON.stringify(pack, null, 2)}\n`))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("NON_CANONICAL")
	})

	it("rejects payload tampering", () => {
		const { files } = createValidFiles()
		files.set(`modules/${MODULE_IDS[1]}/module.html`, Buffer.from("tampered"))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.match(/MODULE_MANIFEST_ID|SIZE_MISMATCH|CHECKSUM_MISMATCH/)
	})

	it("rejects an invalid signature", () => {
		const { files } = createValidFiles()
		const signature = JSON.parse(Buffer.from(files.get("signatures/ed25519.json")!).toString("utf8"))
		signature.signature = Buffer.alloc(64, 1).toString("base64")
		files.set("signatures/ed25519.json", canonicalJsonBytes(signature))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("SIGNATURE_INVALID")
	})

	it("derives the key fingerprint instead of trusting pack.json", () => {
		const { files } = createValidFiles()
		const pack = JSON.parse(Buffer.from(files.get("pack.json")!).toString("utf8"))
		pack.publisher.keyId = `sha256:${"0".repeat(64)}`
		files.set("pack.json", canonicalJsonBytes(pack))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("invalid")
	})

	it("rejects ownership disagreement and undeclared files", () => {
		const owned = createValidFiles()
		const course = JSON.parse(Buffer.from(owned.files.get("course.json")!).toString("utf8"))
		course.modules.pop()
		owned.files.set("course.json", canonicalJsonBytes(course))
		expect(validateLearningPackFiles(owned.files, { aiHydroVersion: "0.2.5" }).diagnostics[0].code).to.equal(
			"MODULE_OWNERSHIP",
		)

		const extra = createValidFiles()
		extra.files.set("unexpected.txt", Buffer.from("no"))
		expect(validateLearningPackFiles(extra.files, { aiHydroVersion: "0.2.5" }).diagnostics[0].code).to.equal(
			"UNDECLARED_FILE",
		)
	})

	it("distinguishes unsupported schema and runtime compatibility", () => {
		const schema = createValidFiles()
		const pack = JSON.parse(Buffer.from(schema.files.get("pack.json")!).toString("utf8"))
		pack.schemaVersion = 2
		schema.files.set("pack.json", canonicalJsonBytes(pack))
		expect(validateLearningPackFiles(schema.files, { aiHydroVersion: "0.2.5" }).status).to.equal("incompatible")

		const runtime = createValidFiles()
		expect(validateLearningPackFiles(runtime.files, { aiHydroVersion: "0.3.0" }).status).to.equal("incompatible")
	})

	it("requires full source-commit provenance", () => {
		const { files } = createValidFiles()
		files.set("provenance/provenance.json", canonicalJsonBytes({ buildKind: "development", sourceCommit: "main" }))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("PROVENANCE_COMMIT")
	})
})
