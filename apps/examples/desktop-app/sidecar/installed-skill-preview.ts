import { constants } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	decodeSkillPreviewText,
	hasControlCharacters,
	isSkillPreviewPath,
	isSkillPreviewTextPath,
	MAX_SKILL_PREVIEW_FILE_BYTES,
} from "./skill-preview-text";

type PreviewFile = { path: string; size: number };
type InstalledSkillRoot = { root: string; defaultPath: string };

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 512;
const MAX_ENTRIES = 2_048;
const MAX_DEPTH = 16;
/** Tooling folders that are never skill content and can dwarf the skill itself. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** The listing stops here; what was gathered so far is still worth showing. */
class PreviewBudgetExceeded extends Error {}
// Colons are also excluded locally to prevent Windows drive/stream paths.
function validFilePath(path: string): boolean {
	return isSkillPreviewPath(path) && !path.includes(":");
}

function withinRoot(root: string, path: string): boolean {
	const child = relative(root, path);
	return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function resolveInstalledSkill(
	args: Record<string, unknown> | undefined,
	installedSkills: unknown,
): Promise<InstalledSkillRoot> {
	const skillPath = args?.skillPath;
	if (
		typeof skillPath !== "string" ||
		!isAbsolute(skillPath) ||
		hasControlCharacters(skillPath)
	) {
		throw new Error("An installed skill path is required.");
	}
	const installed =
		Array.isArray(installedSkills) &&
		installedSkills.some(
			(skill: unknown) =>
				skill !== null &&
				typeof skill === "object" &&
				"path" in skill &&
				typeof skill.path === "string" &&
				resolve(skill.path) === resolve(skillPath),
		);
	if (!installed) throw new Error("This skill is no longer installed.");

	// Resolve the install directory first: symlinked skill installations are
	// valid, but a SKILL.md symlink must not grant access outside that root.
	const root = await realpath(dirname(skillPath));
	const source = await realpath(skillPath);
	if (!withinRoot(root, source) || !(await stat(source)).isFile()) {
		throw new Error("The installed skill file is outside its skill directory.");
	}
	const defaultPath = basename(skillPath);
	if (!validFilePath(defaultPath)) {
		throw new Error("The installed skill file has an unsupported name.");
	}
	return { root, defaultPath };
}

async function readTextFile(
	root: string,
	path: string,
	onReadBytes?: (size: number) => void,
) {
	if (!validFilePath(path) || !isSkillPreviewTextPath(path)) {
		throw new Error("A supported skill file path is required.");
	}
	let source = root;
	for (const part of path.split("/")) {
		source = await realpath(join(source, part));
		if (!withinRoot(root, source)) {
			throw new Error("This file is outside the installed skill directory.");
		}
	}
	const handle = await open(
		source,
		// Windows defines neither flag; the realpath check above rejects links there.
		constants.O_RDONLY |
			(constants.O_NOFOLLOW ?? 0) |
			(constants.O_NONBLOCK ?? 0),
	);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > MAX_SKILL_PREVIEW_FILE_BYTES) {
			throw new Error("This skill file is too large or is not a regular file.");
		}
		// Read at most the limit plus one byte, including if the file grows
		// after stat, rather than allocating from an untrusted file size.
		const bytes = Buffer.alloc(MAX_SKILL_PREVIEW_FILE_BYTES + 1);
		let size = 0;
		while (size < bytes.length) {
			const { bytesRead } = await handle.read(
				bytes,
				size,
				bytes.length - size,
				size,
			);
			if (!bytesRead) break;
			size += bytesRead;
			onReadBytes?.(bytesRead);
		}
		if (size > MAX_SKILL_PREVIEW_FILE_BYTES)
			throw new Error("This skill file is too large.");
		const content = decodeSkillPreviewText(bytes.subarray(0, size));
		return { content, size, localPath: source };
	} finally {
		await handle.close();
	}
}

/**
 * Read the installed copy without running its scripts or fetching remote
 * sources. A skill larger than the preview budget is listed in part, with
 * `truncated` set, rather than failing to open.
 */
export async function getInstalledSkillPreview(
	args: Record<string, unknown> | undefined,
	installedSkills: unknown,
): Promise<{ files: PreviewFile[]; defaultPath: string; truncated?: true }> {
	const { root, defaultPath } = await resolveInstalledSkill(
		args,
		installedSkills,
	);
	const files: PreviewFile[] = [];
	let scanned = 0;
	let totalBytes = 0;
	const spendBytes = (size: number) => {
		totalBytes += size;
		if (totalBytes > MAX_TOTAL_BYTES) throw new PreviewBudgetExceeded();
	};
	const addFile = async (path: string) => {
		if (files.length >= MAX_FILES) throw new PreviewBudgetExceeded();
		const file = await readTextFile(root, path, spendBytes);
		files.push({ path, size: file.size });
	};
	// The skill's own file comes first, so even a huge skill opens on it.
	try {
		await addFile(defaultPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
			throw new Error("The installed skill file is unavailable for preview.");
		throw error;
	}
	const visit = async (
		directory: string,
		ancestors: Set<string>,
		depth: number,
	) => {
		if (depth > MAX_DEPTH) return;
		const source = await realpath(join(root, directory));
		if (!withinRoot(root, source) || ancestors.has(source)) return;
		const visited = new Set(ancestors).add(source);
		const entries = await opendir(source);
		for await (const entry of entries) {
			if (++scanned > MAX_ENTRIES) throw new PreviewBudgetExceeded();
			if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
			const path = directory ? `${directory}/${entry.name}` : entry.name;
			if (path === defaultPath || !validFilePath(path)) continue;
			try {
				const target = await realpath(join(root, path));
				if (!withinRoot(root, target)) continue;
				const info = await stat(target);
				if (info.isDirectory()) {
					await visit(path, visited, depth + 1);
					continue;
				}
				if (
					!info.isFile() ||
					info.size > MAX_SKILL_PREVIEW_FILE_BYTES ||
					!isSkillPreviewTextPath(path)
				)
					continue;
				await addFile(path);
			} catch (error) {
				if (error instanceof PreviewBudgetExceeded) throw error;
				// Unsupported, removed or unreadable optional files do not prevent
				// opening the skill itself.
			}
		}
	};
	let truncated = false;
	try {
		await visit("", new Set(), 0);
	} catch (error) {
		if (!(error instanceof PreviewBudgetExceeded)) throw error;
		truncated = true;
	}
	return {
		files: files.sort((a, b) => a.path.localeCompare(b.path)),
		defaultPath,
		...(truncated ? { truncated: true as const } : undefined),
	};
}

export async function readInstalledSkillFile(
	args: Record<string, unknown> | undefined,
	installedSkills: unknown,
): Promise<{ path: string; content: string; localPath: string }> {
	const { root } = await resolveInstalledSkill(args, installedSkills);
	if (typeof args?.path !== "string") {
		throw new Error("A supported skill file path is required.");
	}
	const { content, localPath } = await readTextFile(root, args.path);
	return { path: args.path, content, localPath };
}
