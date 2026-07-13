import { createHash, createPublicKey, verify } from "node:crypto"
import Ajv from "ajv"
import { satisfies, valid as validSemver, validRange } from "semver"
import packSchema from "../../../schemas/learning-pack/v1/pack.schema.json"
import { parseCanonicalJson, StrictJsonError } from "./canonicalJson"
import type {
	LearningPackChecksums,
	LearningPackCourse,
	LearningPackDiagnostic,
	LearningPackManifest,
	LearningPackRuntimeCompatibility,
	LearningPackSignature,
	LearningPackValidationResult,
} from "./types"

const CHECKSUMS_PATH = "checksums.json"
const SIGNATURE_PATH = "signatures/ed25519.json"
const MAX_INLINE_MODULE_BYTES = 8 * 1024 * 1024
const PAYLOAD_TOP_LEVEL = new Set(["assets", "citations", "datasets", "environments", "modules", "provenance"])
const ajv = new Ajv({ allErrors: true, strict: true })
const validateManifestSchema = ajv.compile(packSchema)

function diagnostic(code: string, message: string, path?: string): LearningPackDiagnostic {
	return { code, message, path }
}

function invalid(code: string, message: string, path?: string): LearningPackValidationResult {
	return { status: "invalid", diagnostics: [diagnostic(code, message, path)] }
}

function incompatible(code: string, message: string, path?: string): LearningPackValidationResult {
	return { status: "incompatible", diagnostics: [diagnostic(code, message, path)] }
}

function bytes(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
	const value = files.get(path)
	if (!value) throw new Error(`Missing required file ${path}`)
	return value
}

function strictBase64(value: string, label: string): Buffer {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw new Error(`${label} is not canonical base64`)
	}
	const decoded = Buffer.from(value, "base64")
	if (decoded.toString("base64") !== value) throw new Error(`${label} is not canonical base64`)
	return decoded
}

function isPayloadPath(path: string): boolean {
	if (path === "pack.json" || path === "course.json") return true
	const slash = path.indexOf("/")
	return slash > 0 && PAYLOAD_TOP_LEVEL.has(path.slice(0, slash))
}

function manifestIdFromHtml(htmlBytes: Uint8Array): string | undefined {
	const html = new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes)
	const match = /<script\s+type=["']application\/vnd\.aihydro\.module\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
	if (!match) return undefined
	const parsed = JSON.parse(match[1]) as { id?: unknown }
	return typeof parsed.id === "string" ? parsed.id : undefined
}

function parseContractJson<T>(files: ReadonlyMap<string, Uint8Array>, path: string): T {
	return parseCanonicalJson(bytes(files, path), path) as T
}

export function validateLearningPackFiles(
	files: ReadonlyMap<string, Uint8Array>,
	runtime: LearningPackRuntimeCompatibility,
): LearningPackValidationResult {
	try {
		for (const required of ["pack.json", "course.json", CHECKSUMS_PATH, SIGNATURE_PATH]) {
			if (!files.has(required)) return invalid("MISSING_FILE", `Missing required file ${required}`, required)
		}

		const rawManifest = parseContractJson<Record<string, unknown>>(files, "pack.json")
		if (rawManifest.schemaVersion !== 1) {
			return incompatible(
				"SCHEMA_VERSION",
				`Unsupported Learning Pack schema version ${String(rawManifest.schemaVersion)}`,
				"pack.json",
			)
		}
		if (!validateManifestSchema(rawManifest)) {
			const detail = validateManifestSchema.errors
				?.map((error) => `${error.instancePath || "/"} ${error.message}`)
				.join("; ")
			return invalid("PACK_SCHEMA", `pack.json does not match the v1 schema: ${detail ?? "unknown error"}`, "pack.json")
		}
		const manifest = rawManifest as unknown as LearningPackManifest
		if (!validSemver(manifest.version)) return invalid("PACK_VERSION", `Invalid pack SemVer ${manifest.version}`, "pack.json")
		if (!validRange(manifest.compatibility.aiHydro)) {
			return invalid("COMPATIBILITY_RANGE", "Invalid AI-Hydro compatibility range", "pack.json")
		}
		if (!validSemver(runtime.aiHydroVersion)) return invalid("RUNTIME_VERSION", "Runtime version is not valid SemVer")
		if (!satisfies(runtime.aiHydroVersion, manifest.compatibility.aiHydro)) {
			return incompatible(
				"AIHYDRO_VERSION",
				`AI-Hydro ${runtime.aiHydroVersion} does not satisfy ${manifest.compatibility.aiHydro}`,
				"pack.json",
			)
		}

		const course = parseContractJson<LearningPackCourse>(files, "course.json")
		if (!course || typeof course !== "object" || !Array.isArray(course.modules)) {
			return invalid("COURSE_SCHEMA", "course.json must contain a modules array", "course.json")
		}
		if (course.courseId !== manifest.ownership.courseId) {
			return invalid("COURSE_OWNERSHIP", "pack.json and course.json course IDs disagree", "course.json")
		}
		const courseIds = course.modules.map((module) => module.id)
		if (new Set(courseIds).size !== courseIds.length)
			return invalid("DUPLICATE_MODULE_ID", "course.json contains duplicate module IDs")
		if (JSON.stringify([...courseIds].sort()) !== JSON.stringify([...manifest.ownership.moduleIds].sort())) {
			return invalid("MODULE_OWNERSHIP", "pack.json and course.json module ownership disagree")
		}
		if (!courseIds.includes(manifest.entryModuleId))
			return invalid("ENTRY_MODULE", "Entry module is not present in course.json")

		for (const module of course.modules) {
			const expectedPath = `modules/${module.id}/module.html`
			if (module.path !== expectedPath)
				return invalid("MODULE_PATH", `Module ${module.id} must use ${expectedPath}`, "course.json")
			const moduleBytes = files.get(expectedPath)
			if (!moduleBytes) return invalid("MISSING_MODULE", `Missing module HTML for ${module.id}`, expectedPath)
			if (moduleBytes.byteLength > MAX_INLINE_MODULE_BYTES) {
				return incompatible("MODULE_TOO_LARGE", `Module ${module.id} exceeds the 8 MiB v1 inline limit`, expectedPath)
			}
			if (manifestIdFromHtml(moduleBytes) !== module.id) {
				return invalid("MODULE_MANIFEST_ID", `Module HTML manifest does not match ${module.id}`, expectedPath)
			}
		}

		parseCanonicalJson(bytes(files, manifest.environmentPath), manifest.environmentPath)
		const provenance = parseCanonicalJson(bytes(files, manifest.provenancePath), manifest.provenancePath) as {
			buildKind?: unknown
			sourceCommit?: unknown
		}
		if (provenance.buildKind !== "development" && provenance.buildKind !== "release") {
			return invalid(
				"PROVENANCE_BUILD_KIND",
				"Provenance buildKind must be development or release",
				manifest.provenancePath,
			)
		}
		if (typeof provenance.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(provenance.sourceCommit)) {
			return invalid(
				"PROVENANCE_COMMIT",
				"Provenance sourceCommit must be a full lowercase Git SHA",
				manifest.provenancePath,
			)
		}

		const checksumsBytes = bytes(files, CHECKSUMS_PATH)
		const checksums = parseCanonicalJson(checksumsBytes, CHECKSUMS_PATH) as LearningPackChecksums
		if (checksums.algorithm !== "sha256" || !Array.isArray(checksums.files)) {
			return invalid("CHECKSUM_SCHEMA", "checksums.json must declare a sha256 file inventory", CHECKSUMS_PATH)
		}
		const listedPaths = checksums.files.map((entry) => entry.path)
		if (new Set(listedPaths).size !== listedPaths.length)
			return invalid("DUPLICATE_CHECKSUM_PATH", "Checksum paths must be unique")
		if (JSON.stringify(listedPaths) !== JSON.stringify([...listedPaths].sort())) {
			return invalid("CHECKSUM_ORDER", "Checksum entries must be sorted by path", CHECKSUMS_PATH)
		}
		for (const entry of checksums.files) {
			if (!isPayloadPath(entry.path)) return invalid("CHECKSUM_PATH", `Invalid checksum payload path ${entry.path}`)
			if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
				return invalid("CHECKSUM_ENTRY", `Invalid checksum entry for ${entry.path}`)
			}
			const payload = files.get(entry.path)
			if (!payload) return invalid("CHECKSUM_MISSING_FILE", `Checksum-listed file is missing: ${entry.path}`)
			if (payload.byteLength !== entry.size) return invalid("SIZE_MISMATCH", `Size mismatch for ${entry.path}`, entry.path)
			const digest = createHash("sha256").update(payload).digest("hex")
			if (digest !== entry.sha256) return invalid("CHECKSUM_MISMATCH", `SHA-256 mismatch for ${entry.path}`, entry.path)
		}
		const allowedPaths = new Set([...listedPaths, CHECKSUMS_PATH, SIGNATURE_PATH])
		for (const path of files.keys()) {
			if (!allowedPaths.has(path)) return invalid("UNDECLARED_FILE", `Archive contains undeclared file ${path}`, path)
		}

		const signature = parseContractJson<LearningPackSignature>(files, SIGNATURE_PATH)
		if (signature.algorithm !== "Ed25519") return invalid("SIGNATURE_ALGORITHM", "Only Ed25519 signatures are supported")
		const publicKeyDer = strictBase64(signature.publicKeySpki, "publicKeySpki")
		const signatureBytes = strictBase64(signature.signature, "signature")
		const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" })
		if (publicKey.asymmetricKeyType !== "ed25519") return invalid("PUBLIC_KEY_TYPE", "Signing key is not Ed25519")
		if (!verify(null, checksumsBytes, publicKey, signatureBytes))
			return invalid("SIGNATURE_INVALID", "Ed25519 signature is invalid")
		const signerFingerprint = `sha256:${createHash("sha256").update(publicKeyDer).digest("hex")}`
		if (manifest.publisher.keyId !== signerFingerprint) {
			return invalid("KEY_ID_MISMATCH", "pack.json publisher key ID does not match the verified public key")
		}

		return {
			status: "valid",
			diagnostics: [],
			verified: Object.freeze({
				manifest: Object.freeze(manifest),
				course: Object.freeze(course),
				checksums: Object.freeze(checksums),
				signerFingerprint,
			}),
		}
	} catch (error) {
		if (error instanceof StrictJsonError) return invalid(error.code, error.message)
		return invalid("VALIDATION_ERROR", error instanceof Error ? error.message : String(error))
	}
}
