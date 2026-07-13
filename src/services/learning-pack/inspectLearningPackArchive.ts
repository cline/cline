import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import type { Entry, ZipFile } from "yauzl"
import { fromBuffer } from "yauzl"
import type {
	LearningPackDiagnostic,
	LearningPackRuntimeCompatibility,
	LearningPackValidationStatus,
	VerifiedLearningPackContract,
} from "./types"
import { validateLearningPackFiles } from "./validateLearningPack"

interface FoldCase {
	full(value: string): string
}

// This small CommonJS dependency publishes no TypeScript declaration.
// biome-ignore lint/style/noCommonJs: typed boundary for a CommonJS-only package
const foldcase = require("@ar-nelson/foldcase") as FoldCase

export const LEARNING_PACK_ARCHIVE_LIMITS = Object.freeze({
	compressedBytes: 256 * 1024 * 1024,
	totalUncompressedBytes: 512 * 1024 * 1024,
	entryCount: 10_000,
	fileBytes: 64 * 1024 * 1024,
})

const ROOT_FILES = new Set(["pack.json", "course.json", "checksums.json"])
const PAYLOAD_DIRECTORIES = new Set(["assets", "citations", "datasets", "environments", "modules", "provenance"])
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_SYMLINK_TYPE = 0o120000
const ZIP_PLATFORM_UNIX = 3
const ZIP_ENCRYPTED_FLAG = 0x1
const ZIP_UTF8_FLAG = 0x800

export interface LearningPackArchiveMetadata {
	readonly archiveSha256: string
	readonly compressedBytes: number
	readonly totalUncompressedBytes: number
	readonly entryCount: number
}

export interface LearningPackArchiveInspection extends LearningPackArchiveMetadata {
	readonly files: ReadonlyMap<string, Uint8Array>
	readonly contract: VerifiedLearningPackContract
}

export interface LearningPackArchiveInspectionResult {
	readonly status: LearningPackValidationStatus
	readonly diagnostics: readonly LearningPackDiagnostic[]
	readonly inspection?: LearningPackArchiveInspection
}

class ArchiveInspectionError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly path?: string,
	) {
		super(message)
	}
}

class ImmutableArchiveFiles implements ReadonlyMap<string, Uint8Array> {
	readonly #files: Map<string, Buffer>

	constructor(files: Map<string, Buffer>) {
		// The map is created inside the inspector and ownership transfers here.
		// Callers only receive defensive byte copies through ReadonlyMap methods.
		this.#files = files
		Object.freeze(this)
	}

	get size(): number {
		return this.#files.size
	}

	get(path: string): Uint8Array | undefined {
		const value = this.#files.get(path)
		return value ? Buffer.from(value) : undefined
	}

	has(path: string): boolean {
		return this.#files.has(path)
	}

	entries(): IterableIterator<[string, Uint8Array]> {
		return new Map([...this.#files].map(([path, bytes]) => [path, Buffer.from(bytes)])).entries()
	}

	keys(): IterableIterator<string> {
		return this.#files.keys()
	}

	values(): IterableIterator<Uint8Array> {
		return new Map([...this.#files].map(([path, bytes]) => [path, Buffer.from(bytes)])).values()
	}

	forEach(callbackfn: (value: Uint8Array, key: string, map: ReadonlyMap<string, Uint8Array>) => void, thisArg?: unknown): void {
		for (const [path, bytes] of this.#files) callbackfn.call(thisArg, Buffer.from(bytes), path, this)
	}

	[Symbol.iterator](): IterableIterator<[string, Uint8Array]> {
		return this.entries()
	}
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) deepFreeze(nested)
		if (!Object.isFrozen(value)) Object.freeze(value)
	}
	return value
}

function freezeDiagnostics(diagnostics: readonly LearningPackDiagnostic[]): readonly LearningPackDiagnostic[] {
	return Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })))
}

function invalid(code: string, message: string, path?: string): LearningPackArchiveInspectionResult {
	return Object.freeze({ status: "invalid", diagnostics: freezeDiagnostics([{ code, message, path }]) })
}

function validateArchivePath(path: string, exactPaths: Set<string>, foldedPaths: Map<string, string>): void {
	if (path.includes("\0")) throw new ArchiveInspectionError("ARCHIVE_PATH_NUL", "Archive path contains a NUL byte", path)
	if (path.includes("\\")) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_BACKSLASH", "Archive paths must use forward slashes", path)
	}
	if (path.normalize("NFC") !== path) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_NORMALIZATION", "Archive path must be Unicode NFC", path)
	}
	if (path.startsWith("/") || /^[a-z]:/i.test(path)) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_ABSOLUTE", "Absolute and drive-letter paths are forbidden", path)
	}
	if (path.includes(":")) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_COLON", "Colons and NTFS alternate-data-stream paths are forbidden", path)
	}
	const components = path.split("/")
	if (components.some((component) => component === "")) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_EMPTY_SEGMENT", "Archive paths cannot contain empty segments", path)
	}
	for (const component of components) {
		if (component === "." || component === "..") {
			throw new ArchiveInspectionError("ARCHIVE_PATH_TRAVERSAL", "Archive traversal segments are forbidden", path)
		}
		if (/[. ]$/.test(component)) {
			throw new ArchiveInspectionError("ARCHIVE_PATH_TRAILING", "Path components cannot end in dots or spaces", path)
		}
		if (RESERVED_WINDOWS_NAME.test(component)) {
			throw new ArchiveInspectionError("ARCHIVE_PATH_RESERVED", "Archive path uses a Windows reserved name", path)
		}
	}

	const [topLevel] = components
	const permitted =
		(components.length === 1 && ROOT_FILES.has(topLevel)) ||
		(components.length > 1 && PAYLOAD_DIRECTORIES.has(topLevel)) ||
		path === "signatures/ed25519.json"
	if (!permitted) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_LAYOUT", "Archive path is outside the v1 layout", path)
	}
	if (exactPaths.has(path)) throw new ArchiveInspectionError("ARCHIVE_PATH_DUPLICATE", "Duplicate archive path", path)
	const folded = foldcase.full(path)
	const collision = foldedPaths.get(folded)
	if (collision !== undefined) {
		throw new ArchiveInspectionError(
			"ARCHIVE_PATH_CASE_COLLISION",
			`Archive path case-folds to the same name as ${collision}`,
			path,
		)
	}
	exactPaths.add(path)
	foldedPaths.set(folded, path)
}

function entryPath(entry: Entry): string {
	const rawName = (entry as Entry & { fileName: Buffer }).fileName
	if (!Buffer.isBuffer(rawName)) return entry.fileName
	if ((entry.generalPurposeBitFlag & ZIP_UTF8_FLAG) === 0 && rawName.some((byte) => byte > 0x7f)) {
		throw new ArchiveInspectionError("ARCHIVE_PATH_ENCODING", "Non-ASCII ZIP paths must declare UTF-8")
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(rawName)
	} catch {
		throw new ArchiveInspectionError("ARCHIVE_PATH_ENCODING", "Archive path is not valid UTF-8")
	}
}

function validateEntryMetadata(entry: Entry, path: string): void {
	if ((entry.generalPurposeBitFlag & ZIP_ENCRYPTED_FLAG) !== 0 || entry.isEncrypted()) {
		throw new ArchiveInspectionError("ARCHIVE_ENCRYPTED", "Encrypted ZIP entries are forbidden", path)
	}
	if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
		throw new ArchiveInspectionError(
			"ARCHIVE_COMPRESSION",
			`Unsupported ZIP compression method ${entry.compressionMethod}`,
			path,
		)
	}
	const platform = entry.versionMadeBy >>> 8
	const unixMode = entry.externalFileAttributes >>> 16
	if (platform === ZIP_PLATFORM_UNIX && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
		throw new ArchiveInspectionError("ARCHIVE_SYMLINK", "Symbolic links are forbidden", path)
	}
	if (entry.uncompressedSize > LEARNING_PACK_ARCHIVE_LIMITS.fileBytes) {
		throw new ArchiveInspectionError("ARCHIVE_FILE_LIMIT", "ZIP entry exceeds the 64 MiB file limit", path)
	}
}

function openZip(bytes: Buffer): Promise<ZipFile> {
	return new Promise((resolve, reject) => {
		fromBuffer(
			bytes,
			{ autoClose: true, lazyEntries: true, decodeStrings: false, validateEntrySizes: true, strictFileNames: true },
			(error, zipfile) => (error ? reject(error) : resolve(zipfile)),
		)
	})
}

function readEntry(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zipfile.openReadStream(entry, (error, stream) => {
			if (error) {
				reject(error)
				return
			}
			const chunks: Buffer[] = []
			let size = 0
			stream.on("data", (chunk: Buffer) => {
				size += chunk.byteLength
				if (size > LEARNING_PACK_ARCHIVE_LIMITS.fileBytes) stream.destroy(new Error("entry exceeds file limit"))
				else chunks.push(chunk)
			})
			stream.once("error", reject)
			stream.once("end", () => resolve(Buffer.concat(chunks, size)))
		})
	})
}

async function preflightArchive(bytes: Buffer): Promise<{ paths: ReadonlySet<string>; totalUncompressedBytes: number }> {
	const zipfile = await openZip(bytes)
	if (zipfile.entryCount > LEARNING_PACK_ARCHIVE_LIMITS.entryCount) {
		zipfile.close()
		throw new ArchiveInspectionError("ARCHIVE_ENTRY_LIMIT", "Archive exceeds the 10,000-entry limit")
	}
	const exactPaths = new Set<string>()
	const foldedPaths = new Map<string, string>()
	let totalUncompressedBytes = 0

	return new Promise((resolve, reject) => {
		let settled = false
		const fail = (error: unknown): void => {
			if (settled) return
			settled = true
			zipfile.close()
			reject(error)
		}
		zipfile.once("error", fail)
		zipfile.once("end", () => {
			if (settled) return
			settled = true
			resolve({ paths: exactPaths, totalUncompressedBytes })
		})
		zipfile.on("entry", (entry: Entry) => {
			try {
				const path = entryPath(entry)
				validateArchivePath(path, exactPaths, foldedPaths)
				validateEntryMetadata(entry, path)
				totalUncompressedBytes += entry.uncompressedSize
				if (totalUncompressedBytes > LEARNING_PACK_ARCHIVE_LIMITS.totalUncompressedBytes) {
					throw new ArchiveInspectionError(
						"ARCHIVE_TOTAL_LIMIT",
						"Archive exceeds the 512 MiB total uncompressed limit",
					)
				}
				zipfile.readEntry()
			} catch (error) {
				fail(error)
			}
		})
		zipfile.readEntry()
	})
}

async function readArchiveFiles(bytes: Buffer, expectedPaths: ReadonlySet<string>): Promise<Map<string, Buffer>> {
	const zipfile = await openZip(bytes)
	const files = new Map<string, Buffer>()
	return new Promise((resolve, reject) => {
		let settled = false
		const fail = (error: unknown): void => {
			if (settled) return
			settled = true
			zipfile.close()
			reject(error)
		}
		zipfile.once("error", fail)
		zipfile.once("end", () => {
			if (settled) return
			settled = true
			if (files.size !== expectedPaths.size) {
				reject(new ArchiveInspectionError("ARCHIVE_ENTRY_CHANGED", "ZIP entries changed after preflight"))
				return
			}
			resolve(files)
		})
		zipfile.on("entry", (entry: Entry) => {
			void (async () => {
				const path = entryPath(entry)
				if (!expectedPaths.has(path)) {
					throw new ArchiveInspectionError("ARCHIVE_ENTRY_CHANGED", "ZIP entry changed after preflight", path)
				}
				files.set(path, await readEntry(zipfile, entry))
				zipfile.readEntry()
			})().catch(fail)
		})
		zipfile.readEntry()
	})
}

export async function inspectLearningPackArchiveBytes(
	archiveBytes: Uint8Array,
	runtime: LearningPackRuntimeCompatibility,
): Promise<LearningPackArchiveInspectionResult> {
	try {
		if (archiveBytes.byteLength > LEARNING_PACK_ARCHIVE_LIMITS.compressedBytes) {
			return invalid("ARCHIVE_COMPRESSED_LIMIT", "Archive exceeds the 256 MiB compressed limit")
		}
		const bytes = Buffer.from(archiveBytes)
		const { paths, totalUncompressedBytes } = await preflightArchive(bytes)
		const files = await readArchiveFiles(bytes, paths)
		const contract = validateLearningPackFiles(files, runtime)
		if (contract.status !== "valid" || contract.verified === undefined) {
			return Object.freeze({ status: contract.status, diagnostics: freezeDiagnostics(contract.diagnostics) })
		}
		const immutableFiles = new ImmutableArchiveFiles(files)
		const inspection = Object.freeze({
			archiveSha256: createHash("sha256").update(bytes).digest("hex"),
			compressedBytes: bytes.byteLength,
			totalUncompressedBytes,
			entryCount: files.size,
			files: immutableFiles,
			contract: deepFreeze(contract.verified),
		})
		return Object.freeze({ status: "valid", diagnostics: Object.freeze([]), inspection })
	} catch (error) {
		if (error instanceof ArchiveInspectionError) return invalid(error.code, error.message, error.path)
		return invalid("ARCHIVE_INVALID", error instanceof Error ? error.message : String(error))
	}
}

export async function inspectLearningPackArchiveFile(
	archivePath: string,
	runtime: LearningPackRuntimeCompatibility,
): Promise<LearningPackArchiveInspectionResult> {
	try {
		const stat = await fs.stat(archivePath)
		if (!stat.isFile()) return invalid("ARCHIVE_NOT_FILE", "Learning Pack archive must be a regular file")
		if (stat.size > LEARNING_PACK_ARCHIVE_LIMITS.compressedBytes) {
			return invalid("ARCHIVE_COMPRESSED_LIMIT", "Archive exceeds the 256 MiB compressed limit")
		}
		return inspectLearningPackArchiveBytes(await fs.readFile(archivePath), runtime)
	} catch (error) {
		return invalid("ARCHIVE_READ", error instanceof Error ? error.message : String(error))
	}
}
