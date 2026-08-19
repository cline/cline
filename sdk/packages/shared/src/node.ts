import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stripUtf8Bom } from "./parse/string";

type ReadFileSyncPath = Parameters<typeof readFileSync>[0];
type ReadFilePath = Parameters<typeof readFile>[0];

/** Read a UTF-8 text file and remove its optional leading byte order mark. */
export function readFileSyncStrippingUtf8Bom(path: ReadFileSyncPath): string {
	return stripUtf8Bom(readFileSync(path, "utf8"));
}

/** Read a UTF-8 text file and remove its optional leading byte order mark. */
export async function readFileStrippingUtf8Bom(
	path: ReadFilePath,
): Promise<string> {
	return stripUtf8Bom(await readFile(path, "utf8"));
}
