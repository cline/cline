import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import {
	inspectLearningPackArchiveBytes,
	inspectLearningPackArchiveFile,
	LEARNING_PACK_ARCHIVE_LIMITS,
} from "../inspectLearningPackArchive"
import { createValidLearningPackFiles } from "./learningPackTestFixture"

interface ZipEntryFixture {
	path: string
	data?: Uint8Array
	flags?: number
	method?: number
	platform?: number
	mode?: number
	declaredCompressedSize?: number
	declaredUncompressedSize?: number
	utf8?: boolean
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}

function createStoredZip(entries: ZipEntryFixture[]): Buffer {
	const localParts: Buffer[] = []
	const centralParts: Buffer[] = []
	let localOffset = 0
	for (const fixture of entries) {
		const name = Buffer.from(fixture.path, "utf8")
		const data = Buffer.from(fixture.data ?? [])
		const flags = (fixture.flags ?? 0) | (fixture.utf8 === false ? 0 : 0x800)
		const method = fixture.method ?? 0
		const compressedSize = fixture.declaredCompressedSize ?? data.byteLength
		const uncompressedSize = fixture.declaredUncompressedSize ?? data.byteLength
		const checksum = crc32(data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(flags, 6)
		local.writeUInt16LE(method, 8)
		local.writeUInt32LE(checksum, 14)
		local.writeUInt32LE(compressedSize, 18)
		local.writeUInt32LE(uncompressedSize, 22)
		local.writeUInt16LE(name.byteLength, 26)
		localParts.push(local, name, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(((fixture.platform ?? 3) << 8) | 20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(flags, 8)
		central.writeUInt16LE(method, 10)
		central.writeUInt32LE(checksum, 16)
		central.writeUInt32LE(compressedSize, 20)
		central.writeUInt32LE(uncompressedSize, 24)
		central.writeUInt16LE(name.byteLength, 28)
		central.writeUInt32LE(((fixture.mode ?? 0o100644) << 16) >>> 0, 38)
		central.writeUInt32LE(localOffset, 42)
		centralParts.push(central, name)
		localOffset += local.byteLength + name.byteLength + data.byteLength
	}
	const centralDirectory = Buffer.concat(centralParts)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(entries.length, 8)
	end.writeUInt16LE(entries.length, 10)
	end.writeUInt32LE(centralDirectory.byteLength, 12)
	end.writeUInt32LE(localOffset, 16)
	return Buffer.concat([...localParts, centralDirectory, end])
}

const RUNTIME = { aiHydroVersion: "0.2.5" }

describe("inspectLearningPackArchive", () => {
	it("preflights a valid ZIP, verifies its signed contract, and returns defensive immutable bytes", async () => {
		const { files, fingerprint } = createValidLearningPackFiles()
		const zip = createStoredZip([...files].map(([filePath, data]) => ({ path: filePath, data })))
		const result = await inspectLearningPackArchiveBytes(zip, RUNTIME)
		expect(result.status).to.equal("valid")
		expect(result.inspection?.contract.signerFingerprint).to.equal(fingerprint)
		expect(result.inspection?.archiveSha256).to.equal(createHash("sha256").update(zip).digest("hex"))
		expect(Object.isFrozen(result)).to.equal(true)
		expect(Object.isFrozen(result.inspection)).to.equal(true)
		expect(Object.isFrozen(result.inspection?.contract.manifest.publisher)).to.equal(true)
		expect(Object.isFrozen(result.inspection?.contract.course.modules)).to.equal(true)
		const firstRead = result.inspection?.files.get("pack.json")
		expect(firstRead).not.to.equal(undefined)
		if (firstRead) firstRead[0] = 0
		expect(result.inspection?.files.get("pack.json")?.[0]).to.equal("{".charCodeAt(0))
		expect("set" in (result.inspection?.files ?? {})).to.equal(false)
	})

	for (const [invalidPath, code] of [
		["/pack.json", "ARCHIVE_PATH_ABSOLUTE"],
		["C:/pack.json", "ARCHIVE_PATH_ABSOLUTE"],
		["../pack.json", "ARCHIVE_PATH_TRAVERSAL"],
		["assets\\file.txt", "ARCHIVE_PATH_BACKSLASH"],
		["assets/file:stream", "ARCHIVE_PATH_COLON"],
		["assets/file\0.txt", "ARCHIVE_PATH_NUL"],
		["assets//file.txt", "ARCHIVE_PATH_EMPTY_SEGMENT"],
		["assets/file. ", "ARCHIVE_PATH_TRAILING"],
		["assets/CON.txt", "ARCHIVE_PATH_RESERVED"],
		["other/file.txt", "ARCHIVE_PATH_LAYOUT"],
		["assets/cafe\u0301.txt", "ARCHIVE_PATH_NORMALIZATION"],
		["assets/", "ARCHIVE_PATH_EMPTY_SEGMENT"],
	] as const) {
		it(`rejects unsafe archive path ${JSON.stringify(invalidPath)}`, async () => {
			const result = await inspectLearningPackArchiveBytes(createStoredZip([{ path: invalidPath }]), RUNTIME)
			expect(result.status).to.equal("invalid")
			expect(result.diagnostics[0].code).to.equal(code)
		})
	}

	it("rejects exact and full-Unicode case-folded collisions", async () => {
		const duplicate = await inspectLearningPackArchiveBytes(
			createStoredZip([{ path: "assets/file.txt" }, { path: "assets/file.txt" }]),
			RUNTIME,
		)
		expect(duplicate.diagnostics[0].code).to.equal("ARCHIVE_PATH_DUPLICATE")

		const caseFolded = await inspectLearningPackArchiveBytes(
			createStoredZip([{ path: "assets/straße.txt" }, { path: "assets/STRASSE.txt" }]),
			RUNTIME,
		)
		expect(caseFolded.diagnostics[0].code).to.equal("ARCHIVE_PATH_CASE_COLLISION")
	})

	it("rejects non-ASCII paths that do not declare UTF-8", async () => {
		const result = await inspectLearningPackArchiveBytes(createStoredZip([{ path: "assets/café.txt", utf8: false }]), RUNTIME)
		expect(result.diagnostics[0].code).to.equal("ARCHIVE_PATH_ENCODING")
	})

	it("rejects encrypted entries, symlinks, and unsupported compression", async () => {
		const encrypted = await inspectLearningPackArchiveBytes(
			createStoredZip([{ path: "pack.json", flags: 1, data: Buffer.alloc(12), declaredUncompressedSize: 0 }]),
			RUNTIME,
		)
		expect(encrypted.diagnostics[0].code, JSON.stringify(encrypted)).to.equal("ARCHIVE_ENCRYPTED")

		const symlink = await inspectLearningPackArchiveBytes(createStoredZip([{ path: "assets/link", mode: 0o120777 }]), RUNTIME)
		expect(symlink.diagnostics[0].code).to.equal("ARCHIVE_SYMLINK")

		const compression = await inspectLearningPackArchiveBytes(createStoredZip([{ path: "pack.json", method: 99 }]), RUNTIME)
		expect(compression.diagnostics[0].code).to.equal("ARCHIVE_COMPRESSION")
	})

	it("rejects per-file, aggregate, and entry-count bombs from central-directory metadata", async () => {
		const fileLimit = await inspectLearningPackArchiveBytes(
			createStoredZip([
				{
					path: "assets/large.bin",
					declaredCompressedSize: LEARNING_PACK_ARCHIVE_LIMITS.fileBytes + 1,
					declaredUncompressedSize: LEARNING_PACK_ARCHIVE_LIMITS.fileBytes + 1,
				},
			]),
			RUNTIME,
		)
		expect(fileLimit.diagnostics[0].code).to.equal("ARCHIVE_FILE_LIMIT")

		const totalLimit = await inspectLearningPackArchiveBytes(
			createStoredZip(
				Array.from({ length: 9 }, (_, index) => ({
					path: `assets/large-${index}.bin`,
					declaredCompressedSize: LEARNING_PACK_ARCHIVE_LIMITS.fileBytes,
					declaredUncompressedSize: LEARNING_PACK_ARCHIVE_LIMITS.fileBytes,
				})),
			),
			RUNTIME,
		)
		expect(totalLimit.diagnostics[0].code).to.equal("ARCHIVE_TOTAL_LIMIT")

		const entryLimit = await inspectLearningPackArchiveBytes(
			createStoredZip(
				Array.from({ length: LEARNING_PACK_ARCHIVE_LIMITS.entryCount + 1 }, (_, index) => ({
					path: `assets/file-${index}`,
				})),
			),
			RUNTIME,
		)
		expect(entryLimit.diagnostics[0].code).to.equal("ARCHIVE_ENTRY_LIMIT")
	})

	it("rejects a compressed archive over 256 MiB from file metadata without reading it", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-limit-"))
		const archivePath = path.join(root, "oversized.aihydropack")
		try {
			const handle = await fs.open(archivePath, "w")
			try {
				await handle.truncate(LEARNING_PACK_ARCHIVE_LIMITS.compressedBytes + 1)
			} finally {
				await handle.close()
			}
			const result = await inspectLearningPackArchiveFile(archivePath, RUNTIME)
			expect(result.diagnostics[0].code).to.equal("ARCHIVE_COMPRESSED_LIMIT")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it("rejects malformed ZIP bytes and delegates missing or undeclared payloads to C1", async () => {
		const malformed = await inspectLearningPackArchiveBytes(Buffer.from("not a zip"), RUNTIME)
		expect(malformed.diagnostics[0].code).to.equal("ARCHIVE_INVALID")

		const { files } = createValidLearningPackFiles()
		files.delete("course.json")
		const missing = await inspectLearningPackArchiveBytes(
			createStoredZip([...files].map(([filePath, data]) => ({ path: filePath, data }))),
			RUNTIME,
		)
		expect(missing.diagnostics[0].code).to.equal("MISSING_FILE")

		const extra = createValidLearningPackFiles().files
		extra.set("assets/undeclared.txt", Buffer.from("no"))
		const undeclared = await inspectLearningPackArchiveBytes(
			createStoredZip([...extra].map(([filePath, data]) => ({ path: filePath, data }))),
			RUNTIME,
		)
		expect(undeclared.diagnostics[0].code).to.equal("UNDECLARED_FILE")
	})

	it("delegates the 8 MiB module HTML boundary to the canonical C1 validator", async () => {
		const oversizedModule = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20)
		const files = createValidLearningPackFiles({ secondModuleBytes: oversizedModule }).files
		const result = await inspectLearningPackArchiveBytes(
			createStoredZip([...files].map(([filePath, data]) => ({ path: filePath, data }))),
			RUNTIME,
		)
		expect(result.status).to.equal("incompatible")
		expect(result.diagnostics[0].code).to.equal("MODULE_TOO_LARGE")
	})
})
