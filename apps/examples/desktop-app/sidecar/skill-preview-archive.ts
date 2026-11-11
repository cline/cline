import { gunzip } from "node:zlib";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** Read regular files in memory without extracting or executing repository files. */
export async function readSkillPreviewArchive(
	bytes: Uint8Array,
): Promise<Map<string, Blob>> {
	try {
		// Bound the expanded tar before passing it to the native archive reader.
		const tar = await new Promise<Buffer>((resolve, reject) => {
			gunzip(bytes, { maxOutputLength: MAX_ARCHIVE_BYTES }, (error, result) => {
				if (error) reject(error);
				else resolve(result);
			});
		});
		// Bun.Archive.files excludes directories and symbolic links.
		return await new Bun.Archive(tar).files();
	} catch (error) {
		if (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ERR_BUFFER_TOO_LARGE"
		) {
			throw new Error(
				"This repository is too large to preview. Open its source to browse the files.",
			);
		}
		throw new Error("The skill repository returned an invalid source archive.");
	}
}
