import { strict as assert } from "node:assert"
import { createHash, generateKeyPairSync } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { canonicalJsonBytes } from "../canonicalJson"
import { verifyPhase1IntegrationArtifacts } from "../phase1IntegrationEvidence"
import { createLearningPackTestArchive, createValidLearningPackFiles } from "./learningPackTestFixture"

describe("Phase 1 cross-repository artifact evidence", () => {
	let root: string
	const bookCommit = "b".repeat(40)

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-phase1-evidence-"))
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	async function fixture() {
		const artifactDirectory = path.join(root, "artifacts")
		await fs.mkdir(artifactDirectory)
		const schemaBytes = await fs.readFile(path.resolve("schemas/learning-pack/v1/pack.schema.json"))
		const schemaSha256 = createHash("sha256").update(schemaBytes).digest("hex")
		const provenanceBytes = canonicalJsonBytes({
			buildKind: "development",
			schemaSha256,
			sourceCommit: bookCommit,
		})
		const { privateKey } = generateKeyPairSync("ed25519")
		const student = createLearningPackTestArchive(
			createValidLearningPackFiles({ edition: "student", privateKey, provenanceBytes }).files,
		)
		const instructor = createLearningPackTestArchive(
			createValidLearningPackFiles({ edition: "instructor", privateKey, provenanceBytes }).files,
		)
		const studentArchiveName = "hmfp-student.aihydropack"
		const instructorArchiveName = "hmfp-instructor.aihydropack"
		await fs.writeFile(path.join(artifactDirectory, studentArchiveName), student)
		await fs.writeFile(path.join(artifactDirectory, instructorArchiveName), instructor)
		return {
			artifactDirectory,
			studentArchiveName,
			instructorArchiveName,
			studentArchiveSha256: createHash("sha256").update(student).digest("hex"),
			instructorArchiveSha256: createHash("sha256").update(instructor).digest("hex"),
			bookCommit,
			runtimeCommit: "c".repeat(40),
			runtimeCheckoutCommit: "c".repeat(40),
			schemaSha256,
			runtimeSchemaPath: path.resolve("schemas/learning-pack/v1/pack.schema.json"),
			aiHydroVersion: "0.2.5",
		}
	}

	it("verifies exact archives, pins, editions, signer, and provenance", async () => {
		const result = await verifyPhase1IntegrationArtifacts(await fixture())
		assert.equal(result.packId, "hmfp")
		assert.equal(result.courseId, "hmfp")
		assert.equal(result.bookCommit, bookCommit)
		assert.deepEqual(
			result.archives.map((archive) => archive.edition),
			["student", "instructor"],
		)
	})

	it("rejects a caller archive hash that does not match verified raw bytes", async () => {
		const options = await fixture()
		await assert.rejects(
			verifyPhase1IntegrationArtifacts({ ...options, studentArchiveSha256: "0".repeat(64) }),
			/pinned caller output/,
		)
	})
})
