import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, constants as zlibConstants } from "node:zlib";
import {
	WORKSPACE_CAPSULE_ARCHIVE_FORMAT,
	WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
	WORKSPACE_CAPSULE_MANIFEST_VERSION,
	WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES,
	WORKSPACE_CAPSULE_MEDIA_TYPE,
	type WorkspaceCapsuleArchiveMetadata,
	WorkspaceCapsuleArchiveMetadataSchema,
} from "@cline/shared";
import {
	type WorkspaceCapsulePlan,
	WorkspaceCapsulePlanningError,
} from "./builder";

const TAR_BLOCK_SIZE = 512;
const TAR_END = Buffer.alloc(TAR_BLOCK_SIZE * 2);

function writeString(
	buffer: Buffer,
	offset: number,
	length: number,
	value: string,
): void {
	const encoded = Buffer.from(value, "utf8");
	if (encoded.byteLength > length) {
		throw new WorkspaceCapsulePlanningError(
			"ARCHIVE_PATH_TOO_LONG",
			`Tar header field is too long: ${value}`,
			value,
		);
	}
	encoded.copy(buffer, offset);
}

function writeOctal(
	buffer: Buffer,
	offset: number,
	length: number,
	value: number,
): void {
	const encoded = value.toString(8).padStart(length - 1, "0");
	writeString(buffer, offset, length, `${encoded}\0`);
}

function splitTarPath(path: string): { name: string; prefix: string } {
	if (Buffer.byteLength(path, "utf8") <= 100) {
		return { name: path, prefix: "" };
	}
	for (
		let index = path.lastIndexOf("/");
		index > 0;
		index = path.lastIndexOf("/", index - 1)
	) {
		const prefix = path.slice(0, index);
		const name = path.slice(index + 1);
		if (
			Buffer.byteLength(name, "utf8") <= 100 &&
			Buffer.byteLength(prefix, "utf8") <= 155
		) {
			return { name, prefix };
		}
	}
	throw new WorkspaceCapsulePlanningError(
		"ARCHIVE_PATH_TOO_LONG",
		`Capsule path cannot be represented in a portable ustar header: ${path}`,
		path,
	);
}

function tarHeader(input: {
	path: string;
	mode: number;
	size: number;
	type: "file" | "directory";
}): Buffer {
	const { name, prefix } = splitTarPath(input.path);
	const header = Buffer.alloc(TAR_BLOCK_SIZE);
	writeString(header, 0, 100, name);
	writeOctal(header, 100, 8, input.mode & 0o777);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, input.size);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header.write(input.type === "directory" ? "5" : "0", 156, 1, "ascii");
	header.write("ustar\0", 257, 6, "ascii");
	header.write("00", 263, 2, "ascii");
	writeString(header, 345, 155, prefix);
	let checksum = 0;
	for (const byte of header) checksum += byte;
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
	return header;
}

function paddingFor(size: number): Buffer | undefined {
	const padding = (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
	return padding > 0 ? Buffer.alloc(padding) : undefined;
}

function serializeManifest(plan: WorkspaceCapsulePlan): Buffer {
	const manifestBytes = Buffer.from(
		`${JSON.stringify(plan.manifest, null, 2)}\n`,
		"utf8",
	);
	if (manifestBytes.byteLength > WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES) {
		throw new WorkspaceCapsulePlanningError(
			"MANIFEST_TOO_LARGE",
			`Capsule manifest exceeds the ${WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES} byte limit`,
			WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
		);
	}
	return manifestBytes;
}

async function* tarChunks(
	plan: WorkspaceCapsulePlan,
	manifestBytes: Buffer,
): AsyncGenerator<Buffer> {
	yield tarHeader({
		path: WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH,
		mode: 0o644,
		size: manifestBytes.byteLength,
		type: "file",
	});
	yield manifestBytes;
	const manifestPadding = paddingFor(manifestBytes.byteLength);
	if (manifestPadding) yield manifestPadding;

	const payloads = new Map(
		plan.payloads.map((payload) => [payload.entryPath, payload]),
	);
	for (const entry of plan.manifest.entries) {
		if (entry.kind === "directory") {
			yield tarHeader({
				path: entry.path,
				mode: entry.mode,
				size: 0,
				type: "directory",
			});
			continue;
		}

		const payload = payloads.get(entry.path);
		if (
			!payload ||
			payload.size !== entry.size ||
			payload.sha256 !== entry.sha256
		) {
			throw new WorkspaceCapsulePlanningError(
				"PAYLOAD_MISSING",
				`Missing or inconsistent payload plan for ${entry.path}`,
				entry.path,
			);
		}
		yield tarHeader({
			path: entry.path,
			mode: entry.mode,
			size: entry.size,
			type: "file",
		});

		const handle = await open(
			payload.sourcePath,
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const before = await handle.stat();
			if (!before.isFile() || before.size !== entry.size) {
				throw new WorkspaceCapsulePlanningError(
					"FILE_CHANGED",
					`Capsule payload changed before archive creation: ${entry.path}`,
					entry.path,
				);
			}
			const hash = createHash("sha256");
			for await (const chunk of handle.createReadStream({ autoClose: false })) {
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				hash.update(bytes);
				yield bytes;
			}
			const after = await handle.stat();
			const digest = hash.digest("hex");
			if (
				after.dev !== before.dev ||
				after.ino !== before.ino ||
				after.size !== before.size ||
				after.mtimeMs !== before.mtimeMs ||
				digest !== entry.sha256
			) {
				throw new WorkspaceCapsulePlanningError(
					"FILE_CHANGED",
					`Capsule payload no longer matches its manifest: ${entry.path}`,
					entry.path,
				);
			}
		} finally {
			await handle.close();
		}
		const padding = paddingFor(entry.size);
		if (padding) yield padding;
	}
	yield TAR_END;
}

/**
 * Create a deterministic gzip-compressed ustar stream for a planned capsule.
 * Member zero is `.cline-capsule-manifest.json`; all remaining member names
 * exactly match `manifest.entries[].path`.
 */
export function createWorkspaceCapsuleArchiveStream(
	plan: WorkspaceCapsulePlan,
): Readable {
	return createArchiveStream(plan, serializeManifest(plan));
}

function createArchiveStream(
	plan: WorkspaceCapsulePlan,
	manifestBytes: Buffer,
): Readable {
	const source = Readable.from(tarChunks(plan, manifestBytes));
	const gzip = createGzip({
		level: 9,
		strategy: zlibConstants.Z_DEFAULT_STRATEGY,
	});
	// Node's pipe() does not forward source errors to the destination. Destroying
	// gzip makes consumers observe validation/hash failures instead of hanging.
	source.once("error", (error) => gzip.destroy(error));
	const compressed = source.pipe(gzip);
	return Readable.from(
		(async function* enforceCompressedLimit(): AsyncGenerator<Buffer> {
			let total = 0;
			try {
				for await (const chunk of compressed) {
					const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					total += bytes.byteLength;
					if (total > plan.limits.maxArchiveBytes) {
						throw new WorkspaceCapsulePlanningError(
							"ARCHIVE_TOO_LARGE",
							`Compressed capsule exceeds the ${plan.limits.maxArchiveBytes} byte archive limit`,
						);
					}
					yield bytes;
				}
			} finally {
				compressed.destroy();
			}
		})(),
	);
}

/** Write a capsule archive without overwriting an existing destination. */
export async function writeWorkspaceCapsuleArchive(
	plan: WorkspaceCapsulePlan,
	outputPath: string,
): Promise<WorkspaceCapsuleArchiveMetadata> {
	const manifestBytes = serializeManifest(plan);
	const archiveStream = createArchiveStream(plan, manifestBytes);
	const hash = createHash("sha256");
	let archiveSizeBytes = 0;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			archiveSizeBytes += chunk.byteLength;
			hash.update(chunk);
			callback(null, chunk);
		},
	});
	let outputHandle: FileHandle | undefined;
	try {
		outputHandle = await open(
			outputPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
			0o600,
		);
		await pipeline(archiveStream, meter, outputHandle.createWriteStream());
	} catch (error) {
		if (outputHandle) {
			await outputHandle.close().catch(() => undefined);
			await rm(outputPath, { force: true }).catch(() => undefined);
		}
		throw error;
	}
	return WorkspaceCapsuleArchiveMetadataSchema.parse({
		version: 1,
		manifestVersion: WORKSPACE_CAPSULE_MANIFEST_VERSION,
		mediaType: WORKSPACE_CAPSULE_MEDIA_TYPE,
		format: WORKSPACE_CAPSULE_ARCHIVE_FORMAT,
		sha256: hash.digest("hex"),
		manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
		archiveSizeBytes,
		unpackedSizeBytes: plan.manifest.totalBytes,
	});
}
