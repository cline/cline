import { readFile, stat } from "node:fs/promises";

const MAX_USER_FILE_BYTES = 20 * 1_000 * 1_024;

export async function loadUserFileContent(path: string): Promise<string> {
	const fileStat = await stat(path);
	if (!fileStat.isFile()) {
		throw new Error("Path is not a file");
	}
	if (fileStat.size > MAX_USER_FILE_BYTES) {
		throw new Error("File is too large to read into context.");
	}
	const content = await readFile(path, "utf8");
	if (content.includes("\u0000")) {
		throw new Error("Cannot read binary file into context.");
	}
	return content;
}
