import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * Minimal tar reader for source archives (GitHub `codeload` tarballs, `git
 * archive` output). Supports ustar name/prefix splitting, pax extended
 * headers (`path`), and GNU long names. Links, devices, and anything else are
 * reported as "other" and left to the caller to skip.
 */
export interface TarEntry {
	path: string;
	type: "file" | "directory" | "other";
	mode: number;
	data: Buffer;
}

const BLOCK = 512;

function readString(block: Buffer, offset: number, length: number): string {
	const end = block.indexOf(0, offset);
	return block
		.subarray(
			offset,
			end === -1 || end > offset + length ? offset + length : end,
		)
		.toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
	const text = readString(block, offset, length).trim();
	return text ? Number.parseInt(text, 8) : 0;
}

function parsePaxPath(data: Buffer): string | undefined {
	// Records are "<length> <key>=<value>\n", length counting the whole record.
	let offset = 0;
	while (offset < data.length) {
		const space = data.indexOf(0x20, offset);
		if (space === -1) break;
		const length = Number.parseInt(data.subarray(offset, space).toString(), 10);
		if (!Number.isFinite(length) || length <= 0) break;
		const record = data
			.subarray(space + 1, offset + length - 1)
			.toString("utf8");
		const equals = record.indexOf("=");
		if (equals !== -1 && record.slice(0, equals) === "path") {
			return record.slice(equals + 1);
		}
		offset += length;
	}
	return undefined;
}

export function* readTarEntries(archive: Buffer): Generator<TarEntry> {
	let offset = 0;
	let nextPath: string | undefined;
	while (offset + BLOCK <= archive.length) {
		const header = archive.subarray(offset, offset + BLOCK);
		offset += BLOCK;
		if (header.every((byte) => byte === 0)) {
			break;
		}
		const size = readOctal(header, 124, 12);
		const typeflag = String.fromCharCode(header[156] ?? 0);
		const dataEnd = offset + size;
		if (!Number.isFinite(size) || size < 0 || dataEnd > archive.length) {
			throw new Error("Truncated or malformed tar archive");
		}
		const data = archive.subarray(offset, dataEnd);
		offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);

		if (typeflag === "x" || typeflag === "L") {
			// Extended header for the next entry: pax `path` or GNU long name.
			nextPath =
				typeflag === "x"
					? (parsePaxPath(data) ?? nextPath)
					: readString(data, 0, data.length);
			continue;
		}
		if (typeflag === "g") {
			continue;
		}

		let path = nextPath;
		nextPath = undefined;
		if (path === undefined) {
			const name = readString(header, 0, 100);
			const prefix =
				readString(header, 257, 6) === "ustar"
					? readString(header, 345, 155)
					: "";
			path = prefix ? `${prefix}/${name}` : name;
		}
		const type =
			typeflag === "0" || typeflag === "\0" || typeflag === "7"
				? "file"
				: typeflag === "5"
					? "directory"
					: "other";
		yield { path, type, mode: readOctal(header, 100, 8), data };
	}
}

function isSafeRelativePath(path: string): boolean {
	return (
		path.length > 0 &&
		!path.startsWith("/") &&
		!/^[a-zA-Z]:/.test(path) &&
		!path.split(/[\\/]/).some((part) => part === "..")
	);
}

/**
 * Extract the regular files of a gzipped tarball whose archive path `select`
 * maps to a destination-relative path. Returns how many files were written.
 */
export function extractTarGz(
	archive: Buffer,
	options: {
		into: string;
		select: (archivePath: string) => string | undefined;
		/** Cap on the decompressed archive; gzip can expand far beyond its download size. */
		maxExtractedBytes?: number;
	},
): number {
	let written = 0;
	const tar = gunzipSync(archive, {
		maxOutputLength: options.maxExtractedBytes,
	});
	for (const entry of readTarEntries(tar)) {
		if (entry.type !== "file") {
			continue;
		}
		const relative = options.select(entry.path);
		if (relative === undefined) {
			continue;
		}
		if (!isSafeRelativePath(relative)) {
			throw new Error(`Refusing to extract unsafe archive path: ${entry.path}`);
		}
		const destination = join(options.into, relative);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, entry.data, {
			mode: entry.mode & 0o111 ? 0o755 : 0o644,
		});
		written += 1;
	}
	return written;
}
