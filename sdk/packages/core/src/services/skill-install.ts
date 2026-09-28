import {
	chmodSync,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { gunzipSync } from "node:zlib";

// Installs a skill from a GitHub repository without shelling out. The
// marketplace used to run `npx skills add`, which fails in the packaged
// desktop app whenever the user has no Node on the app's PATH, or a Node
// older than whatever `skills@latest` currently requires. This downloads the
// repository tarball and copies the skill folder the same way that CLI lays it
// out for Cline: ~/.agents/skills/<sanitized frontmatter name>.

export interface GitHubSkillSource {
	owner: string;
	repo: string;
	ref?: string;
	/** Repository-relative directory to search for skills in. */
	subpath?: string;
	/** Skill to pick when the repository contains several. */
	skill?: string;
}

export interface GitHubSkillInstallOptions {
	/** Defaults to ~/.agents/skills. */
	skillsDir?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	/** Largest repository archive to download. Defaults to 100 MB. */
	maxArchiveBytes?: number;
	/**
	 * Directory names the caller will look the skill up by afterwards. Cline
	 * identifies a skill by its frontmatter name, not its directory, so when
	 * that name isn't one of these the skill is installed under the first one
	 * instead, keeping the caller's installed-check working.
	 */
	acceptedNames?: readonly string[];
}

export interface GitHubSkillInstallResult {
	name: string;
	installPath: string;
	fileCount: number;
	/** Repository-relative paths that could not be copied (e.g. links into submodules). */
	skippedPaths: string[];
}

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_SKILL_BYTES = 50 * 1024 * 1024;
const MAX_LINK_DEPTH = 8;
// Mirrors the skills CLI: directories never searched for SKILL.md, and
// entries never copied into an installed skill.
const SEARCH_SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"__pycache__",
]);
const COPY_SKIP_DIRS = new Set([".git", "__pycache__", "__pypackages__"]);
const COPY_SKIP_FILES = new Set(["metadata.json"]);

const GITHUB_OWNER = /^[A-Za-z0-9-]+$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse marketplace skill install args (`owner/repo`, `owner/repo@skill`,
 * `github.com/owner/repo`, `https://github.com/owner/repo/tree/ref/path`, plus
 * `--skill <name>`). Returns undefined for anything else so callers can fall
 * back to the skills CLI.
 */
export function parseGitHubSkillSource(
	args: readonly string[],
): GitHubSkillSource | undefined {
	let sourceArg: string | undefined;
	let skill: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]?.trim() ?? "";
		if (arg === "--skill" || arg === "-s") {
			skill = args[index + 1]?.trim();
			index++;
			continue;
		}
		if (arg.startsWith("--skill=")) {
			skill = arg.slice("--skill=".length).trim();
			continue;
		}
		if (arg.startsWith("-") || sourceArg !== undefined) {
			return undefined;
		}
		sourceArg = arg;
	}
	if (!sourceArg) return undefined;

	let rest = sourceArg.replace(/^https?:\/\/(?=(www\.)?github\.com\/)/i, "");
	if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) return undefined;
	rest = rest.replace(/^(www\.)?github\.com\//i, "");
	const at = rest.lastIndexOf("@");
	if (at > 0) {
		skill ??= rest.slice(at + 1);
		rest = rest.slice(0, at);
	}
	const segments = trimTrailing(rest, "/").split("/");
	const [owner, rawRepo, marker, ref, ...subpathSegments] = segments;
	const repo = rawRepo?.replace(/\.git$/i, "");
	if (
		!owner ||
		!repo ||
		!GITHUB_OWNER.test(owner) ||
		!GITHUB_REPO.test(repo) ||
		repo === "." ||
		repo === ".."
	) {
		return undefined;
	}
	if (marker === undefined) {
		return { owner, repo, skill: skill || undefined };
	}
	if (marker !== "tree" || !ref) return undefined;
	const subpath = normalizeRelativePath(subpathSegments.join("/"));
	if (subpath === undefined) return undefined;
	return {
		owner,
		repo,
		ref,
		subpath: subpath || undefined,
		skill: skill || undefined,
	};
}

/** Same rule the skills CLI uses to name the installed directory. */
export function sanitizeSkillInstallName(name: string): string {
	const dashed = name.toLowerCase().replace(/[^a-z0-9._]+/g, "-");
	let start = 0;
	let end = dashed.length;
	while (start < end && (dashed[start] === "." || dashed[start] === "-")) {
		start++;
	}
	while (end > start && (dashed[end - 1] === "." || dashed[end - 1] === "-")) {
		end--;
	}
	return dashed.slice(start, end).slice(0, 255) || "unnamed-skill";
}

// Loops instead of /x+$/ regexes, which backtrack polynomially on long runs.
function trimTrailing(value: string, char: string): string {
	let end = value.length;
	while (end > 0 && value[end - 1] === char) end--;
	return value.slice(0, end);
}

export async function installGitHubSkill(
	source: GitHubSkillSource,
	options: GitHubSkillInstallOptions = {},
): Promise<GitHubSkillInstallResult> {
	const archive = await downloadRepositoryArchive(source, options);
	const tree = readTarGz(archive);
	const skill = selectSkill(source, tree);
	const name = resolveDirectoryName(skill.name, options.acceptedNames);
	const skillsDir =
		options.skillsDir ?? join(resolveHomeDir(), ".agents", "skills");
	const { files, skippedPaths } = collectSkillFiles(skill.dir, tree);

	const installPath = join(skillsDir, name);
	// Staged beside the skills directory, not inside it: the skills watcher
	// would otherwise load the half-written copy as a second skill. Same parent,
	// so the final rename stays on one volume.
	const suffix = `${name}-${process.pid}-${Date.now()}`;
	const stagingPath = join(
		dirname(skillsDir),
		`.cline-skill-staging-${suffix}`,
	);
	const backupPath = join(dirname(skillsDir), `.cline-skill-backup-${suffix}`);
	try {
		for (const file of files) {
			const target = join(stagingPath, ...file.relativePath.split("/"));
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, file.data);
			if (process.platform !== "win32" && file.mode & 0o111) {
				chmodSync(target, 0o755);
			}
		}
		mkdirSync(skillsDir, { recursive: true });
		// Move any existing copy aside rather than deleting it, so a failed
		// swap can put it back instead of leaving the user with no skill.
		const hadExisting = existsSync(installPath);
		if (hadExisting) await renameWithRetry(installPath, backupPath);
		try {
			await renameWithRetry(stagingPath, installPath);
		} catch (error) {
			if (hadExisting) await renameWithRetry(backupPath, installPath);
			throw error;
		}
		rmSync(backupPath, { ...RM_OPTIONS });
	} catch (error) {
		rmSync(stagingPath, { ...RM_OPTIONS });
		throw error;
	}
	return { name, installPath, fileCount: files.length, skippedPaths };
}

function resolveDirectoryName(
	skillName: string,
	acceptedNames: readonly string[] | undefined,
): string {
	const name = sanitizeSkillInstallName(skillName);
	const accepted = (acceptedNames ?? []).map(sanitizeSkillInstallName);
	return accepted.length === 0 || accepted.includes(name)
		? name
		: (accepted[0] ?? name);
}

// On Windows, antivirus and search indexers briefly lock freshly written
// files, so removing or renaming the directory right after writing it can
// fail with EPERM/EBUSY for a moment.
const RM_OPTIONS = {
	recursive: true,
	force: true,
	maxRetries: 5,
	retryDelay: 200,
} as const;
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

async function renameWithRetry(from: string, to: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			renameSync(from, to);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code ?? "";
			if (attempt >= 5 || !RENAME_RETRY_CODES.has(code)) throw error;
			await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
		}
	}
}

function resolveHomeDir(): string {
	return (
		process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir()
	);
}

function repoLabel(source: GitHubSkillSource): string {
	return `${source.owner}/${source.repo}`;
}

async function downloadRepositoryArchive(
	source: GitHubSkillSource,
	options: GitHubSkillInstallOptions,
): Promise<Buffer> {
	const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${encodeURIComponent(source.ref ?? "HEAD")}`;
	const fetchImpl = options.fetch ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`Could not download ${repoLabel(source)} from GitHub: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (response.status === 404) {
		throw new Error(
			`GitHub repository ${repoLabel(source)}${source.ref ? ` (ref ${source.ref})` : ""} was not found or is private.`,
		);
	}
	if (!response.ok) {
		throw new Error(
			`Could not download ${repoLabel(source)} from GitHub: HTTP ${response.status}`,
		);
	}
	const maxBytes = options.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
	const declaredLength = Number(response.headers.get("content-length"));
	if (declaredLength > maxBytes) {
		throw new Error(`${repoLabel(source)} is too large to install as a skill.`);
	}
	// Enforce the limit while reading: Content-Length is absent for chunked
	// responses, and buffering the whole body first would defeat the cap.
	const chunks: Uint8Array[] = [];
	let received = 0;
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			throw new Error(
				`${repoLabel(source)} is too large to install as a skill.`,
			);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

type TarEntry =
	| { type: "file"; mode: number; data: Buffer }
	| { type: "symlink"; target: string };

/** Repository-relative POSIX path -> entry, with the archive's top-level directory stripped. */
type RepoTree = Map<string, TarEntry>;

function readTarGz(archive: Buffer): RepoTree {
	let tar: Buffer;
	try {
		tar = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES * 4 });
	} catch (error) {
		throw new Error(
			`Downloaded skill archive is not a valid gzip file: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const tree: RepoTree = new Map();
	let offset = 0;
	let longName: string | undefined;
	let paxPath: string | undefined;
	let paxLinkPath: string | undefined;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const size = parseOctal(header.subarray(124, 136));
		const typeflag = String.fromCharCode(header[156] ?? 0);
		const dataStart = offset + 512;
		const data = tar.subarray(dataStart, dataStart + size);
		offset = dataStart + Math.ceil(size / 512) * 512;

		if (typeflag === "x") {
			const pax = parsePaxRecords(data);
			paxPath = pax.path;
			paxLinkPath = pax.linkpath;
			continue;
		}
		if (typeflag === "g") continue;
		if (typeflag === "L") {
			longName = readCString(data);
			continue;
		}

		const prefix = readCString(header.subarray(345, 500));
		const rawName = readCString(header.subarray(0, 100));
		const name =
			paxPath ?? longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
		const linkName = paxLinkPath ?? readCString(header.subarray(157, 257));
		paxPath = undefined;
		paxLinkPath = undefined;
		longName = undefined;

		// GitHub tarballs wrap everything in a single "<repo>-<sha>/" directory.
		const repoPath = normalizeRelativePath(name.split("/").slice(1).join("/"));
		if (!repoPath) continue;
		if (typeflag === "0" || typeflag === "\0" || typeflag === "7") {
			tree.set(repoPath, {
				type: "file",
				mode: parseOctal(header.subarray(100, 108)),
				data: Buffer.from(data),
			});
		} else if (typeflag === "2") {
			tree.set(repoPath, { type: "symlink", target: linkName });
		}
	}
	return tree;
}

function parseOctal(field: Buffer): number {
	const text = readCString(field).trim();
	return text ? Number.parseInt(text, 8) || 0 : 0;
}

function readCString(field: Buffer): string {
	const end = field.indexOf(0);
	return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function parsePaxRecords(data: Buffer): { path?: string; linkpath?: string } {
	const result: { path?: string; linkpath?: string } = {};
	let offset = 0;
	while (offset < data.length) {
		const space = data.indexOf(0x20, offset);
		if (space === -1) break;
		const length = Number.parseInt(data.subarray(offset, space).toString(), 10);
		if (!length) break;
		const record = data
			.subarray(space + 1, offset + length - 1)
			.toString("utf8");
		const equals = record.indexOf("=");
		const key = record.slice(0, equals);
		if (key === "path" || key === "linkpath") {
			result[key] = record.slice(equals + 1);
		}
		offset += length;
	}
	return result;
}

/** Normalizes to a POSIX relative path; undefined if it escapes the root. */
function normalizeRelativePath(path: string): string | undefined {
	if (!path) return "";
	const normalized = posix.normalize(path.replace(/\\/g, "/"));
	if (normalized === "." || normalized === "./") {
		return "";
	}
	if (
		normalized.startsWith("../") ||
		normalized === ".." ||
		posix.isAbsolute(normalized)
	) {
		return undefined;
	}
	return trimTrailing(normalized, "/");
}

type SkillCandidate = { dir: string; name: string };

function selectSkill(
	source: GitHubSkillSource,
	tree: RepoTree,
): SkillCandidate {
	const searchRoot = source.subpath ?? "";
	const candidates: SkillCandidate[] = [];
	for (const [path, entry] of tree) {
		if (entry.type !== "file" || posix.basename(path) !== "SKILL.md") continue;
		const dir = posix.dirname(path) === "." ? "" : posix.dirname(path);
		if (searchRoot && dir !== searchRoot && !dir.startsWith(`${searchRoot}/`)) {
			continue;
		}
		if (dir.split("/").some((segment) => SEARCH_SKIP_DIRS.has(segment))) {
			continue;
		}
		// Cline's skill loader falls back to the directory name when the
		// frontmatter has none, so accept those skills the same way.
		const name =
			readFrontmatterName(entry.data.toString("utf8")) ??
			(dir ? posix.basename(dir) : source.repo);
		candidates.push({ dir, name });
	}
	const label = `${repoLabel(source)}${searchRoot ? `/${searchRoot}` : ""}`;
	if (candidates.length === 0) {
		throw new Error(`No skills (SKILL.md files) were found in ${label}.`);
	}
	if (source.skill) {
		const wanted = sanitizeSkillInstallName(source.skill);
		const match =
			candidates.find((c) => sanitizeSkillInstallName(c.name) === wanted) ??
			candidates.find(
				(c) => sanitizeSkillInstallName(posix.basename(c.dir)) === wanted,
			);
		if (!match) {
			throw new Error(
				`Skill "${source.skill}" was not found in ${label}. Available: ${candidates
					.map((c) => c.name)
					.join(", ")}`,
			);
		}
		return match;
	}
	const atRoot = candidates.find((c) => c.dir === searchRoot);
	if (atRoot) return atRoot;
	if (candidates.length === 1 && candidates[0]) return candidates[0];
	throw new Error(
		`${label} contains ${candidates.length} skills; choose one with --skill. Available: ${candidates
			.map((c) => c.name)
			.join(", ")}`,
	);
}

function readFrontmatterName(content: string): string | undefined {
	const lines = content.replace(/^﻿/, "").split("\n");
	if (lines[0]?.trim() !== "---") return undefined;
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") return undefined;
		if (!line.startsWith("name:")) continue;
		let value = line.slice("name:".length).trim();
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
			value = value.slice(1, -1).trim();
		}
		return value || undefined;
	}
	return undefined;
}

type SkillFile = { relativePath: string; mode: number; data: Buffer };

function collectSkillFiles(
	skillDir: string,
	tree: RepoTree,
): { files: SkillFile[]; skippedPaths: string[] } {
	const prefix = skillDir ? `${skillDir}/` : "";
	const files: SkillFile[] = [];
	const skippedPaths: string[] = [];
	let totalBytes = 0;

	const add = (relativePath: string, entry: TarEntry & { type: "file" }) => {
		const segments = relativePath.split("/");
		if (
			COPY_SKIP_FILES.has(segments.at(-1) ?? "") ||
			segments.slice(0, -1).some((segment) => COPY_SKIP_DIRS.has(segment))
		) {
			return;
		}
		totalBytes += entry.data.length;
		if (totalBytes > MAX_SKILL_BYTES) {
			throw new Error("Skill is too large to install.");
		}
		files.push({ relativePath, mode: entry.mode, data: entry.data });
	};

	// Symlinks are copied as the content they point at (the skills CLI copies
	// with dereference). Links that leave the archive - typically into git
	// submodules, which GitHub tarballs don't include - are skipped, as a git
	// clone without submodules would leave them broken too.
	const addLinked = (
		relativePath: string,
		repoPath: string,
		target: string,
		depth: number,
	) => {
		const resolved = normalizeRelativePath(
			posix.join(posix.dirname(repoPath), target),
		);
		const entry = resolved === undefined ? undefined : tree.get(resolved);
		if (resolved === undefined || depth > MAX_LINK_DEPTH) {
			skippedPaths.push(repoPath);
			return;
		}
		if (entry?.type === "file") {
			add(relativePath, entry);
			return;
		}
		if (entry?.type === "symlink") {
			addLinked(relativePath, resolved, entry.target, depth + 1);
			return;
		}
		const dirPrefix = `${resolved}/`;
		let found = false;
		for (const [path, child] of tree) {
			if (!path.startsWith(dirPrefix)) continue;
			found = true;
			const childRelative = `${relativePath}/${path.slice(dirPrefix.length)}`;
			if (child.type === "file") {
				add(childRelative, child);
			} else {
				addLinked(childRelative, path, child.target, depth + 1);
			}
		}
		if (!found) skippedPaths.push(repoPath);
	};

	for (const [path, entry] of tree) {
		if (!path.startsWith(prefix)) continue;
		const relativePath = path.slice(prefix.length);
		if (entry.type === "file") {
			add(relativePath, entry);
		} else {
			addLinked(relativePath, path, entry.target, 0);
		}
	}
	return { files, skippedPaths };
}
