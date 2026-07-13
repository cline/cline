import * as fs from "node:fs/promises"
import * as path from "node:path"
import { canonicalJsonBytes } from "../src/services/learning-pack/canonicalJson"
import {
	type Phase1ArtifactVerification,
	verifyPhase1IntegrationArtifacts,
} from "../src/services/learning-pack/phase1IntegrationEvidence"

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

function safeSha(value: string | undefined, length: 40 | 64): string | null {
	return value && new RegExp(`^[0-9a-f]{${length}}$`).test(value) ? value : null
}

async function finalize(): Promise<void> {
	let verification: Phase1ArtifactVerification | undefined
	try {
		verification = JSON.parse(await fs.readFile(required("PHASE1_VERIFICATION_PATH"), "utf8"))
	} catch {
		// A failed verification deliberately produces only bounded status evidence.
	}
	const verificationResult = process.env.PHASE1_VERIFICATION_RESULT === "success" ? "passed" : "failed"
	const runtimeResult = process.env.PHASE1_RUNTIME_RESULT === "success" ? "passed" : "failed"
	await writeJson(required("PHASE1_EVIDENCE_PATH"), {
		schemaVersion: 1,
		phase: "Phase 1 — Learning Pack Packaging, Trust, and Reproducible Distribution",
		generatedAt: new Date().toISOString(),
		os: process.platform,
		book: {
			repository: process.env.PHASE1_BOOK_REPOSITORY ?? null,
			commit: safeSha(process.env.PHASE1_BOOK_COMMIT, 40),
		},
		runtime: {
			repository: "AI-Hydro/AI-Hydro",
			commit: safeSha(process.env.PHASE1_RUNTIME_COMMIT, 40),
		},
		schemaSha256: safeSha(process.env.PHASE1_SCHEMA_SHA256, 64),
		verification: verification ?? null,
		checks: {
			artifactIntegrityAndProvenance: verificationResult,
			realPanelInstallAndExecution: runtimeResult,
		},
		result: verificationResult === "passed" && runtimeResult === "passed" ? "passed" : "failed",
		limitations: [
			"No publisher identity verification or revocation claim",
			"No Python sandboxing claim",
			"No role-based instructor authorization claim",
			"No secure assessment claim",
		],
	})
}

async function main(): Promise<void> {
	const command = process.argv[2]
	if (command === "verify") await verify()
	else if (command === "finalize") await finalize()
	else throw new Error("expected verify or finalize")
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
