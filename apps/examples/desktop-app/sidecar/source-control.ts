// Source control backing for the desktop app's workspace panel: one call
// returns everything the Source Control column renders, plus the small set
// of mutations it offers (stage, unstage, discard, commit, push).

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

/** Working-tree read: null content for binary, empty for a missing file. */
export type WorkingFileReader = (
	path: string,
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
	const show = (rev: string, at: string) =>
		git(["show", `${rev}:${at}`]).then(
			(text) => text,
			() => undefined,
		);
	const isBinary = (...texts: Array<string | null | undefined>) =>
		texts.some((text) => text?.includes("\0"));
	if (staged) {
		const [oldText, newText] = await Promise.all([
			show("HEAD", originalPath ?? path),
			show("", path),
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
	const [oldText, working] = await Promise.all([
		show("", path),
		readWorkingFile(path),
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
	| { type: "commit"; message: string; push: boolean }
	| { type: "push" };

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
		case "commit":
			return {
				type: "commit",
				message: typeof record.message === "string" ? record.message : "",
				push: record.push === true,
			};
		case "push":
			return { type: "push" };
		default:
			throw new Error("Unknown source control action");
	}
}

async function hasUpstream(git: GitRunner): Promise<boolean> {
	return git([
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	]).then(
		() => true,
		() => false,
	);
}

async function hasHead(git: GitRunner): Promise<boolean> {
	return git(["rev-parse", "--verify", "--quiet", "HEAD"]).then(
		() => true,
		() => false,
	);
}

async function push(git: GitRunner): Promise<void> {
	// A branch without an upstream is published rather than failing.
	if (await hasUpstream(git)) await git(["push"]);
	else await git(["push", "-u", "origin", "HEAD"]);
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
		case "commit": {
			const message = action.message.trim();
			if (!message) throw new Error("A commit message is required.");
			await git(["commit", "-m", message]);
			if (action.push) await push(git);
			return;
		}
		case "push":
			await push(git);
			return;
	}
}
