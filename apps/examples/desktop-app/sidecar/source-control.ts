// Source control backing for the desktop app's workspace panel: one call
// returns everything the Source Control column renders, plus the small set
// of mutations it offers (stage, unstage, discard) plus a background fetch.
// Committing, pushing, and pulling are left to the agent.

/** Runs git in the repository and resolves stdout; rejects on non-zero exit. */
export type GitRunner = (args: string[]) => Promise<string>;

export type SourceControlStatus = "M" | "A" | "D" | "R" | "?" | "U";

export type SourceControlFile = {
	/** Repository-root-relative, forward slashes. */
	path: string;
	/** Previous path of a staged rename or copy; unstaging must cover both. */
	originalPath?: string;
	status: SourceControlStatus;
	additions: number | null;
	deletions: number | null;
};

export type SourceControlCommit = {
	sha: string;
	shortSha: string;
	subject: string;
	relativeDate: string;
	/** False when the commit is ahead of the upstream branch. */
	pushed: boolean;
};

export type SourceControlState = {
	environmentId: string;
	/** Null when `cwd` is not inside a git repository. */
	root: string | null;
	branch: string | null;
	hasUpstream: boolean;
	ahead: number;
	behind: number;
	staged: SourceControlFile[];
	unstaged: SourceControlFile[];
	untracked: SourceControlFile[];
	commits: SourceControlCommit[];
};

export type GitFileDiff = {
	environmentId: string;
	path: string;
	/** Undefined when the file did not exist on the old side (added). */
	oldText?: string;
	newText: string;
	binary: boolean;
	/** The working copy exceeded the read cap, so a diff would be misleading. */
	truncated: boolean;
};

/**
 * Working-tree read: null content for binary, empty for a missing file.
 * `symlink` asks for the link's own text, which is what git stores.
 */
export type WorkingFileReader = (
	path: string,
	options: { symlink: boolean },
) => Promise<{ content: string | null; truncated: boolean }>;

const COMMIT_LIMIT = 15;
const UNTRACKED_COUNT_LIMIT = 40;

function statusFromCode(code: string): SourceControlStatus {
	switch (code) {
		case "A":
		case "C":
			return "A";
		case "D":
			return "D";
		case "R":
			return "R";
		case "U":
			return "U";
		default:
			return "M";
	}
}

export type ParsedStatus = {
	branch: string | null;
	hasUpstream: boolean;
	ahead: number;
	behind: number;
	staged: ParsedStatusEntry[];
	unstaged: ParsedStatusEntry[];
	untracked: string[];
};

type ParsedStatusEntry = {
	path: string;
	originalPath?: string;
	status: SourceControlStatus;
};

/** Parses `git status --porcelain=v1 -z --branch --untracked-files=all`. */
export function parseStatus(output: string): ParsedStatus {
	const result: ParsedStatus = {
		branch: null,
		hasUpstream: false,
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		untracked: [],
	};
	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record) continue;
		if (record.startsWith("## ")) {
			const header = record.slice(3);
			const match = header.match(
				/^(.+?)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?$/,
			);
			if (match) {
				result.branch = match[1].startsWith("No commits yet on ")
					? match[1].slice("No commits yet on ".length)
					: match[1] === "HEAD (no branch)"
						? null
						: match[1];
				result.hasUpstream = Boolean(match[2]);
				result.ahead = Number(match[3] ?? 0);
				result.behind = Number(match[4] ?? 0);
			}
			continue;
		}
		if (record.length < 4) continue;
		const x = record[0];
		const y = record[1];
		const path = record.slice(3);
		if (x === "?" && y === "?") {
			result.untracked.push(path);
			continue;
		}
		if (x === "!" && y === "!") continue;
		// Renames and copies carry the original path in the next record. Only
		// renames keep it: unstaging a copy must not touch its source file.
		const hasOrigin = x === "R" || x === "C" || y === "R" || y === "C";
		const origin = hasOrigin ? records[++index] : undefined;
		const originalPath = x === "R" || y === "R" ? origin : undefined;
		const entry = (status: SourceControlStatus): ParsedStatusEntry =>
			originalPath ? { path, originalPath, status } : { path, status };
		if (
			x === "U" ||
			y === "U" ||
			(x === "A" && y === "A") ||
			(x === "D" && y === "D")
		) {
			result.unstaged.push(entry("U"));
		} else {
			if (x !== " " && x !== "?") {
				result.staged.push(entry(statusFromCode(x)));
			}
			if (y !== " " && y !== "?") {
				result.unstaged.push(entry(statusFromCode(y)));
			}
		}
	}
	return result;
}

/** Parses `git diff --numstat -z`; binary files report null counts. */
export function parseNumstat(
	output: string,
): Map<string, { additions: number | null; deletions: number | null }> {
	const counts = new Map<
		string,
		{ additions: number | null; deletions: number | null }
	>();
	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record) continue;
		// Only the first two tabs are separators; filenames may contain tabs.
		const [add, del, ...pathParts] = record.split("\t");
		let path: string | undefined = pathParts.length
			? pathParts.join("\t")
			: undefined;
		if (path === undefined) continue;
		// Renames: `add\tdel\t\0old\0new\0`.
		if (path === "") {
			index += 2;
			path = records[index] ?? "";
		}
		if (!path) continue;
		counts.set(path, {
			additions: add === "-" ? null : Number(add),
			deletions: del === "-" ? null : Number(del),
		});
	}
	return counts;
}

const LOG_FORMAT = "%H%x1f%h%x1f%s%x1f%cr%x1e";

export function parseLog(
	output: string,
	unpushed: Set<string>,
	hasUpstream: boolean,
) {
	const commits: SourceControlCommit[] = [];
	for (const record of output.split("\x1e")) {
		const trimmed = record.replace(/^\n/, "");
		if (!trimmed) continue;
		const [sha, shortSha, subject, relativeDate] = trimmed.split("\x1f");
		if (!sha || !shortSha) continue;
		commits.push({
			sha,
			shortSha,
			subject: subject ?? "",
			relativeDate: relativeDate ?? "",
			// Without an upstream nothing has been published yet.
			pushed: hasUpstream && !unpushed.has(sha),
		});
	}
	return commits;
}

export function countLines(text: string): number {
	if (!text) return 0;
	let count = 0;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 10) count++;
	}
	return text.endsWith("\n") ? count : count + 1;
}

export async function getSourceControlState(
	git: GitRunner,
	environmentId: string,
	options: {
		/** Reads a root-relative untracked file to size it; absent over hosts without cheap reads. */
		readUntracked?: (path: string) => Promise<string | null>;
	} = {},
): Promise<SourceControlState> {
	const empty: SourceControlState = {
		environmentId,
		root: null,
		branch: null,
		hasUpstream: false,
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		untracked: [],
		commits: [],
	};
	const root = (
		await git(["rev-parse", "--show-toplevel"]).catch(() => "")
	).trim();
	if (!root) return empty;
	const status = parseStatus(
		await git([
			"status",
			"--porcelain=v1",
			"-z",
			"--branch",
			"--untracked-files=all",
		]),
	);
	const [stagedCounts, unstagedCounts, logOutput, unpushedOutput] =
		await Promise.all([
			git(["diff", "--cached", "--numstat", "-z"]).then(
				parseNumstat,
				() => new Map(),
			),
			git(["diff", "--numstat", "-z"]).then(parseNumstat, () => new Map()),
			git(["log", `-n${COMMIT_LIMIT}`, `--format=${LOG_FORMAT}`]).catch(
				() => "",
			),
			status.hasUpstream
				? git(["rev-list", "@{upstream}..HEAD"]).catch(() => "")
				: Promise.resolve(""),
		]);
	const withCounts = (
		files: ParsedStatusEntry[],
		counts: Map<string, { additions: number | null; deletions: number | null }>,
	): SourceControlFile[] =>
		files.map((file) => ({
			...file,
			additions: counts.get(file.path)?.additions ?? null,
			deletions: counts.get(file.path)?.deletions ?? null,
		}));
	const untracked = await Promise.all(
		status.untracked.map(async (path, index): Promise<SourceControlFile> => {
			const text =
				options.readUntracked && index < UNTRACKED_COUNT_LIMIT
					? await options.readUntracked(path).catch(() => null)
					: null;
			return {
				path,
				status: "?",
				additions: text === null ? null : countLines(text),
				deletions: text === null ? null : 0,
			};
		}),
	);
	const unpushed = new Set(
		unpushedOutput
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	);
	return {
		environmentId,
		root,
		branch: status.branch,
		hasUpstream: status.hasUpstream,
		ahead: status.ahead,
		behind: status.behind,
		staged: withCounts(status.staged, stagedCounts),
		unstaged: withCounts(status.unstaged, unstagedCounts),
		untracked,
		commits: parseLog(logOutput, unpushed, status.hasUpstream),
	};
}

export type CommitFile = {
	path: string;
	/** Previous path when the commit renamed the file. */
	originalPath?: string;
	status: SourceControlStatus;
	additions: number | null;
	deletions: number | null;
};

export type CommitDetails = {
	environmentId: string;
	sha: string;
	files: CommitFile[];
};

// Git's empty tree: what a root commit is compared against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Rejects anything that is not a plain object name, so it cannot act as an option. */
export function assertCommitSha(sha: string): void {
	if (!/^[0-9a-f]{4,64}$/i.test(sha)) throw new Error("Invalid commit");
}

async function commitBase(git: GitRunner, sha: string): Promise<string> {
	return git(["rev-parse", "--verify", "--quiet", `${sha}^`]).then(
		(parent) => parent.trim() || EMPTY_TREE,
		() => EMPTY_TREE,
	);
}

/** Parses `git diff --name-status -z -M`. */
export function parseNameStatus(
	output: string,
): Array<{ path: string; originalPath?: string; status: SourceControlStatus }> {
	const files: Array<{
		path: string;
		originalPath?: string;
		status: SourceControlStatus;
	}> = [];
	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const code = records[index];
		if (!code) continue;
		const letter = code[0] ?? "M";
		if (letter === "R" || letter === "C") {
			const from = records[++index] ?? "";
			const to = records[++index] ?? "";
			if (!to) continue;
			files.push(
				letter === "R"
					? { path: to, originalPath: from, status: "R" }
					: { path: to, status: "A" },
			);
			continue;
		}
		const path = records[++index];
		if (path) files.push({ path, status: statusFromCode(letter) });
	}
	return files;
}

/** Files a commit changed, compared with its first parent. */
export async function getCommitDetails(
	git: GitRunner,
	environmentId: string,
	sha: string,
): Promise<CommitDetails> {
	assertCommitSha(sha);
	const base = await commitBase(git, sha);
	const [nameStatus, numstat] = await Promise.all([
		git(["diff", "--name-status", "-z", "-M", base, sha]),
		git(["diff", "--numstat", "-z", "-M", base, sha]).then(
			parseNumstat,
			() => new Map(),
		),
	]);
	return {
		environmentId,
		sha,
		files: parseNameStatus(nameStatus).map((file) => ({
			...file,
			additions: numstat.get(file.path)?.additions ?? null,
			deletions: numstat.get(file.path)?.deletions ?? null,
		})),
	};
}

// Only these mean "no such path on that side"; anything else (an output
// limit, a corrupt object) must surface rather than pass for a deletion.
const MISSING_OBJECT =
	/does not exist|exists on disk, but not in|but not at stage|invalid object name|not a valid object name|bad revision|unknown revision/i;

function showBlob(
	git: GitRunner,
	rev: string,
	path: string,
): Promise<string | undefined> {
	return git(["show", `${rev}:${path}`]).catch((error: unknown) => {
		if (MISSING_OBJECT.test(String(error))) return undefined;
		throw error;
	});
}

type TreeEntry = { mode: string; sha: string; stage?: string };

/**
 * Mode and object of a path in a tree (`rev`) or, for `null`, the index. An
 * unresolved conflict has no stage-0 index entry, so the index side is our
 * version (stage 2), the side `git diff` compares a conflict against.
 */
async function treeEntry(
	git: GitRunner,
	rev: string | null,
	path: string,
): Promise<TreeEntry | undefined> {
	const output = await git(
		rev === null
			? [LITERAL, "ls-files", "--stage", "--", path]
			: [LITERAL, "ls-tree", rev, "--", path],
	).catch(() => "");
	const entries = Array.from(
		output.matchAll(/^(\d{6}) (?:\w+ )?([0-9a-f]{40,64})(?: (\d))?\t/gm),
		(match) => ({ mode: match[1] ?? "", sha: match[2] ?? "", stage: match[3] }),
	);
	if (rev !== null) return entries[0];
	return entries.find((entry) => entry.stage === "0" || entry.stage === "2");
}

const GITLINK = "160000";
const SYMLINK = "120000";

// Submodules have no blob to show; git's own diff renders them as the
// commit each side points at, so the preview does the same.
function subprojectText(sha: string | undefined): string | undefined {
	return sha ? `Subproject commit ${sha}\n` : undefined;
}

/** One side of a diff: a submodule renders as its commit, anything else as the blob. */
async function sideContents(
	git: GitRunner,
	rev: string,
	path: string,
	entry: TreeEntry | undefined,
): Promise<string | undefined> {
	return entry?.mode === GITLINK
		? subprojectText(entry.sha)
		: showBlob(git, rev, path);
}

/**
 * The submodule checked out at `path`, as git diff shows it: its HEAD, with
 * `-dirty` when it has uncommitted changes of its own. Empty for a directory
 * that is not its own repository root (an uninitialized submodule, which
 * would otherwise report the superproject's HEAD); undefined when `path` is
 * not a directory, so the caller reads it as a file.
 */
async function workingSubproject(
	git: GitRunner,
	path: string,
): Promise<string | undefined> {
	const prefix = await git(["-C", path, "rev-parse", "--show-prefix"]).catch(
		() => undefined,
	);
	if (prefix === undefined) return undefined;
	if (prefix.trim() !== "") return "";
	const head = (
		await git(["-C", path, "rev-parse", "HEAD"]).catch(() => "")
	).trim();
	if (!head) return "";
	const dirty =
		(
			await git(["-C", path, "status", "--porcelain"]).catch(() => "")
		).trim() !== "";
	return `Subproject commit ${head}${dirty ? "-dirty" : ""}\n`;
}

/** Contents of a path before and after a commit. */
export async function getCommitFileDiff(
	git: GitRunner,
	environmentId: string,
	sha: string,
	path: string,
	originalPath?: string,
): Promise<GitFileDiff> {
	assertCommitSha(sha);
	const base = await commitBase(git, sha);
	const oldPath = originalPath ?? path;
	const [oldEntry, newEntry] = await Promise.all([
		base === EMPTY_TREE ? undefined : treeEntry(git, base, oldPath),
		treeEntry(git, sha, path),
	]);
	// Each side is read by its own mode, so a file replaced by a submodule
	// (or the reverse) keeps its contents on the file side.
	const [oldText, newText] = await Promise.all([
		base === EMPTY_TREE
			? undefined
			: sideContents(git, base, oldPath, oldEntry),
		sideContents(git, sha, path, newEntry),
	]);
	return {
		environmentId,
		path,
		oldText,
		newText: newText ?? "",
		binary: [oldText, newText].some((text) => text?.includes("\0")),
		truncated: false,
	};
}

/**
 * Old/new contents for a root-relative path. `staged` compares HEAD to the
 * index; otherwise the index (or HEAD for untracked paths, which have no
 * index entry) to the working tree.
 */
export async function getGitFileDiff(
	git: GitRunner,
	readWorkingFile: WorkingFileReader,
	environmentId: string,
	path: string,
	staged: boolean,
	/** For staged renames, the path the old contents live at in HEAD. */
	originalPath?: string,
): Promise<GitFileDiff> {
	const isBinary = (...texts: Array<string | null | undefined>) =>
		texts.some((text) => text?.includes("\0"));
	const indexEntry = await treeEntry(git, null, path);
	if (staged) {
		const headEntry = await treeEntry(git, "HEAD", originalPath ?? path);
		const [oldText, newText] = await Promise.all([
			sideContents(git, "HEAD", originalPath ?? path, headEntry),
			sideContents(git, "", path, indexEntry),
		]);
		return {
			environmentId,
			path,
			oldText,
			newText: newText ?? "",
			binary: isBinary(oldText, newText),
			truncated: false,
		};
	}
	if (indexEntry?.mode === GITLINK) {
		const checkout = await workingSubproject(git, path);
		if (checkout !== undefined) {
			return {
				environmentId,
				path,
				oldText: subprojectText(indexEntry.sha),
				newText: checkout,
				binary: false,
				truncated: false,
			};
		}
	}
	// A submodule replaced by a file (or deleted) in the working tree reads
	// through the file reader, keeping its binary and truncation flags.
	const [oldText, working] = await Promise.all([
		sideContents(git, indexEntry?.stage === "2" ? ":2" : "", path, indexEntry),
		readWorkingFile(path, { symlink: indexEntry?.mode === SYMLINK }),
	]);
	return {
		environmentId,
		path,
		oldText,
		newText: working.content ?? "",
		binary: working.content === null || isBinary(oldText, working.content),
		truncated: working.truncated,
	};
}

export type SourceControlAction =
	| { type: "stage"; paths: string[] }
	| { type: "unstage"; paths: string[] }
	| { type: "discard"; paths: string[]; untrackedPaths: string[] }
	/** Background refresh of remote-tracking refs; never touches the work tree. */
	| { type: "fetch" };

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is string =>
					typeof item === "string" && item.trim().length > 0,
			)
		: [];
}

export function parseSourceControlAction(value: unknown): SourceControlAction {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	switch (record.type) {
		case "stage":
		case "unstage":
			return { type: record.type, paths: stringList(record.paths) };
		case "discard":
			return {
				type: "discard",
				paths: stringList(record.paths),
				untrackedPaths: stringList(record.untrackedPaths),
			};
		case "fetch":
			return { type: "fetch" };
		default:
			throw new Error("Unknown source control action");
	}
}

async function hasHead(git: GitRunner): Promise<boolean> {
	return git(["rev-parse", "--verify", "--quiet", "HEAD"]).then(
		() => true,
		() => false,
	);
}

// Filenames are data, never patterns: without this, `draft*.txt` would also
// match (and discard) every other file the glob covers.
const LITERAL = "--literal-pathspecs";

export async function runSourceControlAction(
	git: GitRunner,
	action: SourceControlAction,
): Promise<void> {
	switch (action.type) {
		case "stage":
			if (action.paths.length) {
				await git([LITERAL, "add", "--", ...action.paths]);
			}
			return;
		case "unstage":
			if (action.paths.length) {
				// Before the first commit there is no HEAD to restore from; drop
				// the entries from the index and leave the working files alone.
				if (await hasHead(git)) {
					await git([LITERAL, "restore", "--staged", "--", ...action.paths]);
				} else {
					await git([
						LITERAL,
						"rm",
						"--cached",
						"--quiet",
						"--",
						...action.paths,
					]);
				}
			}
			return;
		case "discard":
			if (action.paths.length) {
				await git([LITERAL, "restore", "--worktree", "--", ...action.paths]);
			}
			if (action.untrackedPaths.length) {
				await git([LITERAL, "clean", "-f", "--", ...action.untrackedPaths]);
			}
			return;
		case "fetch":
			await git(["fetch", "--quiet"]);
			return;
	}
}
