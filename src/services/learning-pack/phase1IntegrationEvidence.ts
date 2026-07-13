import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { inspectLearningPackArchiveFile, type LearningPackArchiveInspection } from "./inspectLearningPackArchive"

const FULL_SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.aihydropack$/

export interface Phase1ArtifactVerificationOptions {
	readonly artifactDirectory: string
	readonly studentArchiveName: string
	readonly instructorArchiveName: string
	readonly studentArchiveSha256: string
	readonly instructorArchiveSha256: string
	readonly bookCommit: string
	readonly runtimeCommit: string
	readonly runtimeCheckoutCommit: string
	readonly schemaSha256: string
	readonly runtimeSchemaPath: string
	readonly aiHydroVersion: string
}

export interface Phase1ArchiveEvidence {
	readonly name: string
	readonly sha256: string
	readonly edition: "student" | "instructor"
}

export interface Phase1ArtifactVerification {
	readonly bookCommit: string
	readonly runtimeCommit: string
	readonly schemaSha256: string
	readonly packId: string
	readonly courseId: string
	readonly version: string
	readonly signerFingerprint: string
	readonly buildKind: string
	readonly archives: readonly Phase1ArchiveEvidence[]
}

interface Provenance {
	readonly buildKind?: unknown
	readonly schemaSha256?: unknown
	readonly sourceCommit?: unknown
}

function assertMatch(value: string, pattern: RegExp, label: string): void {
	if (!pattern.test(value)) throw new Error(`${label} is not canonical`)
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex")
}

function parseProvenance(inspection: LearningPackArchiveInspection): Provenance {
	const provenancePath = inspection.contract.manifest.provenancePath
	const bytes = inspection.files.get(provenancePath)
	if (!bytes) throw new Error(`verified archive is missing ${provenancePath}`)
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Provenance
}

async function inspectExpectedArchive(
	archivePath: string,
	expectedSha256: string,
	expectedEdition: "student" | "instructor",
	aiHydroVersion: string,
): Promise<LearningPackArchiveInspection> {
	const result = await inspectLearningPackArchiveFile(archivePath, { aiHydroVersion })
	if (result.status !== "valid" || !result.inspection) {
		throw new Error(`${expectedEdition} archive failed production inspection`)
	}
	if (result.inspection.archiveSha256 !== expectedSha256) {
		throw new Error(`${expectedEdition} archive SHA-256 does not match the pinned caller output`)
	}
	if (result.inspection.contract.manifest.edition !== expectedEdition) {
		throw new Error(`${expectedEdition} artifact contains the wrong edition`)
	}
	return result.inspection
}

/** Verify the caller artifact and cross-repository pins without installing it. */
export async function verifyPhase1IntegrationArtifacts(
	options: Phase1ArtifactVerificationOptions,
): Promise<Phase1ArtifactVerification> {
	for (const [label, value] of [
		["book commit", options.bookCommit],
		["runtime commit", options.runtimeCommit],
		["runtime checkout commit", options.runtimeCheckoutCommit],
	] as const) {
		assertMatch(value, FULL_SHA, label)
	}
	for (const [label, value] of [
		["student archive SHA-256", options.studentArchiveSha256],
		["instructor archive SHA-256", options.instructorArchiveSha256],
		["schema SHA-256", options.schemaSha256],
	] as const) {
		assertMatch(value, SHA256, label)
	}
	for (const [label, value] of [
		["student archive name", options.studentArchiveName],
		["instructor archive name", options.instructorArchiveName],
	] as const) {
		assertMatch(value, ARCHIVE_NAME, label)
		if (path.basename(value) !== value) throw new Error(`${label} must be a basename`)
	}
	if (options.studentArchiveName === options.instructorArchiveName) {
		throw new Error("student and instructor archive names must differ")
	}
	if (options.runtimeCommit !== options.runtimeCheckoutCommit) {
		throw new Error("runtime checkout does not match the pinned reusable-workflow commit")
	}

	const directoryEntries = await fs.readdir(options.artifactDirectory, { withFileTypes: true })
	const actualNames = directoryEntries.map((entry) => entry.name).sort()
	const expectedNames = [options.instructorArchiveName, options.studentArchiveName].sort()
	if (directoryEntries.some((entry) => !entry.isFile()) || JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
		throw new Error("downloaded artifact must contain exactly the pinned student and instructor archives")
	}

	const runtimeSchema = await fs.readFile(options.runtimeSchemaPath)
	if (sha256(runtimeSchema) !== options.schemaSha256) {
		throw new Error("book schema snapshot does not match the runtime-owned schema")
	}

	const student = await inspectExpectedArchive(
		path.join(options.artifactDirectory, options.studentArchiveName),
		options.studentArchiveSha256,
		"student",
		options.aiHydroVersion,
	)
	const instructor = await inspectExpectedArchive(
		path.join(options.artifactDirectory, options.instructorArchiveName),
		options.instructorArchiveSha256,
		"instructor",
		options.aiHydroVersion,
	)
	const studentManifest = student.contract.manifest
	const instructorManifest = instructor.contract.manifest
	for (const [label, left, right] of [
		["pack ID", studentManifest.packId, instructorManifest.packId],
		["course ID", studentManifest.ownership.courseId, instructorManifest.ownership.courseId],
		["version", studentManifest.version, instructorManifest.version],
		["signer fingerprint", student.contract.signerFingerprint, instructor.contract.signerFingerprint],
		[
			"module ownership",
			JSON.stringify(studentManifest.ownership.moduleIds),
			JSON.stringify(instructorManifest.ownership.moduleIds),
		],
	] as const) {
		if (left !== right) throw new Error(`student and instructor ${label} disagree`)
	}

	const provenances = [parseProvenance(student), parseProvenance(instructor)]
	for (const provenance of provenances) {
		if (provenance.sourceCommit !== options.bookCommit) throw new Error("pack provenance does not match the book commit")
		if (provenance.schemaSha256 !== options.schemaSha256) throw new Error("pack provenance schema hash is not pinned")
		if (provenance.buildKind !== "development" && provenance.buildKind !== "release") {
			throw new Error("pack provenance has an unknown build kind")
		}
	}
	if (provenances[0].buildKind !== provenances[1].buildKind) {
		throw new Error("student and instructor provenance build kinds disagree")
	}

	return Object.freeze({
		bookCommit: options.bookCommit,
		runtimeCommit: options.runtimeCommit,
		schemaSha256: options.schemaSha256,
		packId: studentManifest.packId,
		courseId: studentManifest.ownership.courseId,
		version: studentManifest.version,
		signerFingerprint: student.contract.signerFingerprint,
		buildKind: provenances[0].buildKind as string,
		archives: Object.freeze([
			Object.freeze({
				name: options.studentArchiveName,
				sha256: options.studentArchiveSha256,
				edition: "student" as const,
			}),
			Object.freeze({
				name: options.instructorArchiveName,
				sha256: options.instructorArchiveSha256,
				edition: "instructor" as const,
			}),
		]),
	})
}
