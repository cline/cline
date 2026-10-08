import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getFileIndex } from "@cline/core";

export const MAX_LISTED_WORKSPACE_FILES = 20_000;
export const MAX_READ_WORKSPACE_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

export type WorkspaceFileList = {
	files: string[];
	truncated: boolean;
};

export type WorkspaceFileContents = {
	path: string;
	size: number;
	contents: string;
	binary: boolean;
	truncated: boolean;
};

/** Workspace-relative POSIX paths, honoring .gitignore like @-mention search. */
export async function listWorkspaceFiles(
	root: string,
): Promise<WorkspaceFileList> {
	const files = Array.from(await getFileIndex(root)).sort();
	return {
		files: files.slice(0, MAX_LISTED_WORKSPACE_FILES),
		truncated: files.length > MAX_LISTED_WORKSPACE_FILES,
	};
}

/**
 * Reads a file for display. Symlinks are resolved before the containment
 * check so a link inside the workspace cannot expose files outside it.
 */
export async function readWorkspaceFile(
	root: string,
	path: string,
): Promise<WorkspaceFileContents> {
	const realRoot = await realpath(root);
	const target = await realpath(resolve(realRoot, path));
	const relativePath = relative(realRoot, target);
	if (
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error(`File is outside the workspace: ${path}`);
	}
	const handle = await open(target, "r");
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) {
			throw new Error(`Not a file: ${path}`);
		}
		const buffer = Buffer.alloc(
			Math.min(stats.size, MAX_READ_WORKSPACE_FILE_BYTES),
		);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const bytes = buffer.subarray(0, bytesRead);
		const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
		return {
			path,
			size: stats.size,
			contents: binary ? "" : bytes.toString("utf8"),
			binary,
			truncated: !binary && stats.size > bytesRead,
		};
	} finally {
		await handle.close();
	}
}
