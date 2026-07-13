import { expect } from "chai"
import { canonicalJsonBytes } from "../canonicalJson"
import { validateLearningPackFiles } from "../validateLearningPack"
import { createValidLearningPackFiles, TEST_MODULE_IDS } from "./learningPackTestFixture"

describe("validateLearningPackFiles", () => {
	it("validates canonical bytes, ownership, checksums, and the derived Ed25519 fingerprint", () => {
		const { files, fingerprint } = createValidLearningPackFiles()
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("valid")
		expect(result.verified?.signerFingerprint).to.equal(fingerprint)
	})

	it("rejects duplicate JSON object keys before schema validation", () => {
		const { files } = createValidLearningPackFiles()
		files.set("pack.json", Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n'))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("invalid")
		expect(result.diagnostics[0].code).to.equal("DUPLICATE_KEY")
	})

	it("rejects semantically valid but noncanonical JSON", () => {
		const { files } = createValidLearningPackFiles()
		const pack = JSON.parse(Buffer.from(files.get("pack.json")!).toString("utf8"))
		files.set("pack.json", Buffer.from(`${JSON.stringify(pack, null, 2)}\n`))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("NON_CANONICAL")
	})

	it("rejects payload tampering", () => {
		const { files } = createValidLearningPackFiles()
		files.set(`modules/${TEST_MODULE_IDS[1]}/module.html`, Buffer.from("tampered"))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.match(/MODULE_MANIFEST_ID|SIZE_MISMATCH|CHECKSUM_MISMATCH/)
	})

	it("rejects an invalid signature", () => {
		const { files } = createValidLearningPackFiles()
		const signature = JSON.parse(Buffer.from(files.get("signatures/ed25519.json")!).toString("utf8"))
		signature.signature = Buffer.alloc(64, 1).toString("base64")
		files.set("signatures/ed25519.json", canonicalJsonBytes(signature))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("SIGNATURE_INVALID")
	})

	it("derives the key fingerprint instead of trusting pack.json", () => {
		const { files } = createValidLearningPackFiles()
		const pack = JSON.parse(Buffer.from(files.get("pack.json")!).toString("utf8"))
		pack.publisher.keyId = `sha256:${"0".repeat(64)}`
		files.set("pack.json", canonicalJsonBytes(pack))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.status).to.equal("invalid")
	})

	it("rejects ownership disagreement and undeclared files", () => {
		const owned = createValidLearningPackFiles()
		const course = JSON.parse(Buffer.from(owned.files.get("course.json")!).toString("utf8"))
		course.modules.pop()
		owned.files.set("course.json", canonicalJsonBytes(course))
		expect(validateLearningPackFiles(owned.files, { aiHydroVersion: "0.2.5" }).diagnostics[0].code).to.equal(
			"MODULE_OWNERSHIP",
		)

		const extra = createValidLearningPackFiles()
		extra.files.set("unexpected.txt", Buffer.from("no"))
		expect(validateLearningPackFiles(extra.files, { aiHydroVersion: "0.2.5" }).diagnostics[0].code).to.equal(
			"UNDECLARED_FILE",
		)
	})

	it("distinguishes unsupported schema and runtime compatibility", () => {
		const schema = createValidLearningPackFiles()
		const pack = JSON.parse(Buffer.from(schema.files.get("pack.json")!).toString("utf8"))
		pack.schemaVersion = 2
		schema.files.set("pack.json", canonicalJsonBytes(pack))
		expect(validateLearningPackFiles(schema.files, { aiHydroVersion: "0.2.5" }).status).to.equal("incompatible")

		const runtime = createValidLearningPackFiles()
		expect(validateLearningPackFiles(runtime.files, { aiHydroVersion: "0.3.0" }).status).to.equal("incompatible")
	})

	it("requires full source-commit provenance", () => {
		const { files } = createValidLearningPackFiles()
		files.set("provenance/provenance.json", canonicalJsonBytes({ buildKind: "development", sourceCommit: "main" }))
		const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
		expect(result.diagnostics[0].code).to.equal("PROVENANCE_COMMIT")
	})
})
