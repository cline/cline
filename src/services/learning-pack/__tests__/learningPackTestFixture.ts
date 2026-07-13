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
	firstModuleBytes?: Uint8Array
	secondModuleBytes?: Uint8Array
	version?: string
	edition?: "student" | "instructor"
	packId?: string
	courseId?: string
	privateKey?: KeyObject
	provenanceBytes?: Uint8Array
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
		[`modules/${TEST_MODULE_IDS[0]}/module.html`, options?.firstModuleBytes ?? moduleHtml(TEST_MODULE_IDS[0], false)],
		[`modules/${TEST_MODULE_IDS[1]}/module.html`, options?.secondModuleBytes ?? moduleHtml(TEST_MODULE_IDS[1], true)],
		["environments/environment.json", canonicalJsonBytes({ python: ">=3.11" })],
		[
			"provenance/provenance.json",
			options?.provenanceBytes ?? canonicalJsonBytes({ buildKind: "development", sourceCommit: "a".repeat(40) }),
		],
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

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}

/** Deterministic stored ZIP used only by synthetic public test fixtures. */
export function createLearningPackTestArchive(files: ReadonlyMap<string, Uint8Array>): Buffer {
	const localParts: Buffer[] = []
	const centralParts: Buffer[] = []
	let localOffset = 0
	for (const [filePath, value] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
		const name = Buffer.from(filePath, "utf8")
		const data = Buffer.from(value)
		const checksum = crc32(data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0x800, 6)
		local.writeUInt32LE(checksum, 14)
		local.writeUInt32LE(data.byteLength, 18)
		local.writeUInt32LE(data.byteLength, 22)
		local.writeUInt16LE(name.byteLength, 26)
		localParts.push(local, name, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE((3 << 8) | 20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0x800, 8)
		central.writeUInt32LE(checksum, 16)
		central.writeUInt32LE(data.byteLength, 20)
		central.writeUInt32LE(data.byteLength, 24)
		central.writeUInt16LE(name.byteLength, 28)
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
		central.writeUInt32LE(localOffset, 42)
		centralParts.push(central, name)
		localOffset += local.byteLength + name.byteLength + data.byteLength
	}
	const directory = Buffer.concat(centralParts)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(files.size, 8)
	end.writeUInt16LE(files.size, 10)
	end.writeUInt32LE(directory.byteLength, 12)
	end.writeUInt32LE(localOffset, 16)
	return Buffer.concat([...localParts, directory, end])
}
