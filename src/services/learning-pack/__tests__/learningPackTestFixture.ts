import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { canonicalJsonBytes } from "../canonicalJson"
import type { LearningPackManifest } from "../types"

export const TEST_MODULE_IDS = ["hmfp.orientation.00", "hmfp.water-balance.01"]

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

export function createValidLearningPackFiles(options?: {
	secondModuleBytes?: Uint8Array
	version?: string
	edition?: "student" | "instructor"
	packId?: string
	courseId?: string
	privateKey?: KeyObject
}): {
	files: Map<string, Uint8Array>
	fingerprint: string
} {
	const generated = options?.privateKey ? undefined : generateKeyPairSync("ed25519")
	const privateKey = options?.privateKey ?? generated!.privateKey
	const publicKey = options?.privateKey ? createPublicKey(options.privateKey) : generated!.publicKey
	const publicKeyDer = publicKey.export({ format: "der", type: "spki" })
	const fingerprint = `sha256:${createHash("sha256").update(publicKeyDer).digest("hex")}`
	const manifest: LearningPackManifest = {
		schemaVersion: 1,
		packId: options?.packId ?? "hmfp",
		version: options?.version ?? "0.1.0",
		edition: options?.edition ?? "student",
		title: "Hydrologic Modeling from First Principles",
		license: "CC-BY-4.0",
		publisher: { name: "Synthetic Test", keyId: fingerprint },
		ownership: { courseId: options?.courseId ?? "hmfp", moduleIds: TEST_MODULE_IDS },
		entryModuleId: TEST_MODULE_IDS[0],
		compatibility: { aiHydro: ">=0.2.5 <0.3.0", packApi: 1, runtimeContract: "html-preview-v1" },
		capabilities: { localPython: "terminal-equivalent", webExternalOrigins: [] },
		environmentPath: "environments/environment.json",
		provenancePath: "provenance/provenance.json",
	}
	const course = {
		courseId: options?.courseId ?? "hmfp",
		title: "Synthetic Course",
		modules: TEST_MODULE_IDS.map((id) => ({ id, path: `modules/${id}/module.html`, title: id })),
	}
	const payload = new Map<string, Uint8Array>([
		["pack.json", canonicalJsonBytes(manifest)],
		["course.json", canonicalJsonBytes(course)],
		[`modules/${TEST_MODULE_IDS[0]}/module.html`, moduleHtml(TEST_MODULE_IDS[0], false)],
		[`modules/${TEST_MODULE_IDS[1]}/module.html`, options?.secondModuleBytes ?? moduleHtml(TEST_MODULE_IDS[1], true)],
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
