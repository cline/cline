import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { CheckpointEntry } from "@cline/core";

// What the agent changed, per turn and across the session, from the git
// checkpoints Core records before each turn's first model call. Turn N's
// changes are checkpoint N against checkpoint N+1 (or the working tree for
// the latest turn); the session's are the first checkpoint against the
// working tree. Each side is reduced to a git tree so a single `diff-tree`
// yields paths, statuses, and line counts.

const execFileAsync = promisify(execFile);
const MAX_FILES = 500;
const MAX_TEXT_BYTES = 1024 * 1024;
const OID = /^[0-9a-f]{40,64}$/;

export type SessionChangeStatus = "A" | "M" | "D";

export type SessionChangeFile = {
	/** Repository-root-relative, forward slashes. */
	path: string;
	status: SessionChangeStatus;
	/** Null for binary files. */
	additions: number | null;
	deletions: number | null;
	/** Blob before the change; absent when the file was added. */
	oldOid?: string;
	/** Blob after the change; absent when the file was deleted. */
	newOid?: string;
};

export type SessionChangeSet = {
	files: SessionChangeFile[];
	/** Changed files beyond the cap that are not listed. */
	omitted: number;
};

export type SessionChanges = {
	root: string;
	session: SessionChangeSet;
	turns: Array<SessionChangeSet & { runCount: number }>;
};

export type SessionChangeContents = {
	oldText?: string;
	newText: string;
	binary: boolean;
	truncated: boolean;
};

type Git = (args: string[], env?: Record<string, string>) => Promise<string>;

export function localGit(root: string): Git {
	return async (args, env) =>
		(
			await execFileAsync("git", args, {
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, ...env },
				maxBuffer: 64 * 1024 * 1024,
				windowsHide: true,
			})
		).stdout;
}

// Checkpoint trees never change, and diffs between two trees never change,
// so both are memoized for the life of the sidecar.
const checkpointTrees = new Map<string, string>();
const treeDiffs = new Map<string, SessionChangeSet>();

async function withTempIndex<T>(
	run: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "cline-session-changes-"));
	try {
		return await run({ GIT_INDEX_FILE: join(dir, "index") });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * The checkpoint's full snapshot. Stash-shaped checkpoints keep files that
 * were untracked at snapshot time in a third parent rather than their own
 * tree; reading both trees into one index overlays them (their paths never
 * overlap, since a path is either tracked or untracked).
 */
async function checkpointTree(git: Git, ref: string): Promise<string> {
	// Keyed by commit id alone: object ids name content, so the same
	// checkpoint commit always yields the same snapshot tree.
	const cached = checkpointTrees.get(ref);
	if (cached) return cached;
	const tree = (await git(["rev-parse", `${ref}^{tree}`])).trim();
	const untracked = (
		await git(["rev-parse", "--verify", "--quiet", `${ref}^3^{tree}`]).catch(
			() => "",
		)
	).trim();
	const snapshot = untracked
		? await withTempIndex(async (env) => {
				await git(["read-tree", tree, untracked], env);
				return (await git(["write-tree"], env)).trim();
			})
		: tree;
	checkpointTrees.set(ref, snapshot);
	return snapshot;
}

/**
 * The working tree as a git tree: tracked and untracked (not ignored) files,
 * written through a copy of the real index so unchanged files keep their
 * stat cache instead of being rehashed.
 */
async function worktreeTree(git: Git, root: string): Promise<string> {
	const realIndex = resolve(
		root,
		(await git(["rev-parse", "--git-path", "index"])).trim(),
	);
	return await withTempIndex(async (env) => {
		const copied = await copyFile(realIndex, env.GIT_INDEX_FILE).then(
			() => true,
			() => false,
		);
		if (!copied) {
			await git(["read-tree", "--empty"], env);
		}
		await git(["-c", "core.splitIndex=false", "add", "-A", "--", "."], env);
		return (await git(["write-tree"], env)).trim();
	});
}

function parseRaw(
	output: string,
): Map<string, Omit<SessionChangeFile, "additions" | "deletions">> {
	const files = new Map<
		string,
		Omit<SessionChangeFile, "additions" | "deletions">
	>();
	const fields = output.split("\0");
	for (let index = 0; index + 1 < fields.length; index += 2) {
		const meta = fields[index] ?? "";
		const path = fields[index + 1] ?? "";
		if (!meta.startsWith(":") || !path) continue;
		const [, , oldOid, newOid, code] = meta.slice(1).split(" ");
		const status: SessionChangeStatus =
			code === "A" ? "A" : code === "D" ? "D" : "M";
		files.set(path, {
			path,
			status,
			...(status !== "A" && oldOid ? { oldOid } : {}),
			...(status !== "D" && newOid ? { newOid } : {}),
		});
	}
	return files;
}

function parseNumstat(
	output: string,
): Map<string, { additions: number | null; deletions: number | null }> {
	const counts = new Map<
		string,
		{ additions: number | null; deletions: number | null }
	>();
	for (const record of output.split("\0")) {
		const first = record.indexOf("\t");
		const second = record.indexOf("\t", first + 1);
		if (first < 0 || second < 0) continue;
		const added = record.slice(0, first);
		const deleted = record.slice(first + 1, second);
		counts.set(record.slice(second + 1), {
			additions: added === "-" ? null : Number(added),
			deletions: deleted === "-" ? null : Number(deleted),
		});
	}
	return counts;
}

async function diffTrees(
	git: Git,
	from: string,
	to: string,
): Promise<SessionChangeSet> {
	if (from === to) return { files: [], omitted: 0 };
	const key = `${from}:${to}`;
	const cached = treeDiffs.get(key);
	if (cached) return cached;
	const base = ["diff-tree", "-r", "-z", "--no-renames", "--no-abbrev"];
	const [raw, numstat] = await Promise.all([
		git([...base, from, to]),
		git([...base, "--numstat", from, to]),
	]);
	const counts = parseNumstat(numstat);
	const files = [...parseRaw(raw).values()]
		.map((file) => ({
			...file,
			...(counts.get(file.path) ?? { additions: null, deletions: null }),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
	const result = {
		files: files.slice(0, MAX_FILES),
		omitted: Math.max(0, files.length - MAX_FILES),
	};
	treeDiffs.set(key, result);
	return result;
}

export async function getSessionChanges(
	git: Git,
	root: string,
	checkpoints: readonly CheckpointEntry[],
): Promise<SessionChanges> {
	const ordered = [
		...new Map(checkpoints.map((entry) => [entry.runCount, entry])).values(),
	].sort((a, b) => a.runCount - b.runCount);
	if (ordered.length === 0) {
		return { root, session: { files: [], omitted: 0 }, turns: [] };
	}
	const [snapshots, worktree] = await Promise.all([
		Promise.all(ordered.map((entry) => checkpointTree(git, entry.ref))),
		worktreeTree(git, root),
	]);
	const points = [...snapshots, worktree];
	const [session, ...turns] = await Promise.all([
		diffTrees(git, points[0] as string, worktree),
		...ordered.map((_, index) =>
			diffTrees(git, points[index] as string, points[index + 1] as string),
		),
	]);
	return {
		root,
		session: session as SessionChangeSet,
		turns: turns.map((turn, index) => ({
			runCount: (ordered[index] as CheckpointEntry).runCount,
			...turn,
		})),
	};
}

async function readBlob(
	git: Git,
	oid: string,
): Promise<{ text: string; binary: boolean; truncated: boolean }> {
	if (!OID.test(oid)) throw new Error(`Invalid object id: ${oid}`);
	const size = Number((await git(["cat-file", "-s", oid])).trim());
	if (size > MAX_TEXT_BYTES)
		return { text: "", binary: false, truncated: true };
	const text = await git(["cat-file", "blob", oid]);
	return text.includes("\0")
		? { text: "", binary: true, truncated: false }
		: { text, binary: false, truncated: false };
}

export async function readSessionChangeContents(
	git: Git,
	oldOid: string | undefined,
	newOid: string | undefined,
): Promise<SessionChangeContents> {
	const empty = { text: "", binary: false, truncated: false };
	const [before, after] = await Promise.all([
		oldOid ? readBlob(git, oldOid) : undefined,
		newOid ? readBlob(git, newOid) : empty,
	]);
	const binary = Boolean(before?.binary || after.binary);
	const truncated = Boolean(before?.truncated || after.truncated);
	return {
		...(before && !binary && !truncated ? { oldText: before.text } : {}),
		newText: binary || truncated ? "" : after.text,
		binary,
		truncated,
	};
}
