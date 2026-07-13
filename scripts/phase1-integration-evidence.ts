import * as fs from "node:fs/promises"
import * as path from "node:path"
import { canonicalJsonBytes } from "../src/services/learning-pack/canonicalJson"
import { verifyPhase1IntegrationArtifacts } from "../src/services/learning-pack/phase1IntegrationEvidence"

function required(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value
}

async function writeJson(target: string, value: object): Promise<void> {
	await fs.mkdir(path.dirname(target), { recursive: true })
	await fs.writeFile(target, canonicalJsonBytes(value))
}

async function verify(): Promise<void> {
	const verification = await verifyPhase1IntegrationArtifacts({
		artifactDirectory: required("PHASE1_ARTIFACT_DIR"),
		studentArchiveName: required("PHASE1_STUDENT_ARCHIVE"),
		instructorArchiveName: required("PHASE1_INSTRUCTOR_ARCHIVE"),
		studentArchiveSha256: required("PHASE1_STUDENT_SHA256"),
		instructorArchiveSha256: required("PHASE1_INSTRUCTOR_SHA256"),
		bookCommit: required("PHASE1_BOOK_COMMIT"),
		runtimeCommit: required("PHASE1_RUNTIME_COMMIT"),
		runtimeCheckoutCommit: required("PHASE1_RUNTIME_CHECKOUT_COMMIT"),
		schemaSha256: required("PHASE1_SCHEMA_SHA256"),
		runtimeSchemaPath: required("PHASE1_RUNTIME_SCHEMA"),
		aiHydroVersion: required("PHASE1_AIHYDRO_VERSION"),
	})
	await writeJson(required("PHASE1_VERIFICATION_PATH"), verification)
	console.log(`Verified ${verification.packId} ${verification.version} at ${verification.bookCommit}`)
}

async function main(): Promise<void> {
	const command = process.argv[2]
	if (command === "verify") await verify()
	else throw new Error("expected verify")
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
