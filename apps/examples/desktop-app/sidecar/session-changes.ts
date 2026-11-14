import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { CheckpointEntry } from "@cline/core";

// What the agent changed in the last turn and across the session, from the
// git checkpoints Core records before each turn's first model call: the
// latest checkpoint against the working tree, and the first checkpoint
// against the working tree. Each side is reduced to a git tree so a single
// `diff-tree` yields paths, statuses, and line counts.

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
	lastTurn: SessionChangeSet & { runCount: number };
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
	const tree = (await git(["rev-parse", `${ref}^{tree}`])).trim();
	const untracked = (
		await git(["rev-parse", "--verify", "--quiet", `${ref}^3^{tree}`]).catch(
			() => "",
		)
	).trim();
	if (!untracked) return tree;
	return await withTempIndex(async (env) => {
		await git(["read-tree", tree, untracked], env);
		return (await git(["write-tree"], env)).trim();
	});
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
	return {
		files: files.slice(0, MAX_FILES),
		omitted: Math.max(0, files.length - MAX_FILES),
	};
}

export async function getSessionChanges(
	git: Git,
	root: string,
	/** Non-empty; callers report a session without checkpoints themselves. */
	checkpoints: readonly CheckpointEntry[],
): Promise<SessionChanges> {
	const ordered = [...checkpoints].sort((a, b) => a.runCount - b.runCount);
	const first = ordered[0] as CheckpointEntry;
	const last = ordered.at(-1) as CheckpointEntry;
	const [firstTree, lastTree, worktree] = await Promise.all([
		checkpointTree(git, first.ref),
		checkpointTree(git, last.ref),
		worktreeTree(git, root),
	]);
	const [session, lastTurn] = await Promise.all([
		diffTrees(git, firstTree, worktree),
		diffTrees(git, lastTree, worktree),
	]);
	return { root, session, lastTurn: { runCount: last.runCount, ...lastTurn } };
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
