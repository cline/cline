import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckpointEntry } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getSessionChanges,
	localGit,
	readSessionChangeContents,
} from "./session-changes";

let repo: string;

function git(...args: string[]): string {
	// Fixtures must not inherit a developer's signing or fsmonitor setup.
	return execFileSync(
		"git",
		[
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.fsmonitor=false",
			...args,
		],
		{ cwd: repo, encoding: "utf8" },
	).trim();
}

// Mirrors Core's stash-shaped checkpoint: tracked changes in the stash tree,
// untracked files in a third parent.
function checkpoint(runCount: number): CheckpointEntry {
	const stash = git("stash", "create", `cline checkpoint run=${runCount}`);
	const untrackedFiles = git("ls-files", "--others", "--exclude-standard")
		.split("\n")
		.filter(Boolean);
	if (!stash && untrackedFiles.length === 0) {
		return {
			ref: git("rev-parse", "HEAD"),
			createdAt: runCount,
			runCount,
			kind: "commit",
		};
	}
	const base = stash || git("rev-parse", "HEAD");
	const tree = git("rev-parse", `${base}^{tree}`);
	const head = git("rev-parse", "HEAD");
	const index = stash
		? git("rev-parse", `${stash}^2`)
		: git("commit-tree", tree, "-p", head, "-m", "index");
	const parents = ["-p", head, "-p", index];
	if (untrackedFiles.length > 0) {
		const indexFile = join(repo, ".git", "scratch-index");
		const env = { ...process.env, GIT_INDEX_FILE: indexFile };
		execFileSync("git", ["add", "--force", ...untrackedFiles], {
			cwd: repo,
			env,
		});
		const untrackedTree = execFileSync("git", ["write-tree"], {
			cwd: repo,
			env,
			encoding: "utf8",
		}).trim();
		rmSync(indexFile, { force: true });
		parents.push("-p", git("commit-tree", untrackedTree, "-m", "untracked"));
	}
	return {
		ref: git("commit-tree", tree, ...parents, "-m", `checkpoint ${runCount}`),
		createdAt: runCount,
		runCount,
		kind: "stash",
	};
}

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "cline-session-changes-test-"));
	git("init", "-q", "-b", "main");
	writeFileSync(join(repo, "a.ts"), "one\ntwo\n");
	writeFileSync(join(repo, "README.md"), "# readme\n");
	git("add", ".");
	git("commit", "-q", "-m", "init");
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

const summary = (
	files: {
		path: string;
		status: string;
		additions: number | null;
		deletions: number | null;
	}[],
) =>
	files.map(
		(file) =>
			`${file.status} ${file.path} +${file.additions} -${file.deletions}`,
	);

describe("getSessionChanges", () => {
	it("reports the last turn and the session, including files the agent created but never staged", async () => {
		writeFileSync(join(repo, "notes.txt"), "user scratch\n");
		const first = checkpoint(1);
		// Turn 1: edit a tracked file and create an untracked one.
		writeFileSync(join(repo, "a.ts"), "one\nTWO\nthree\n");
		writeFileSync(join(repo, "new.ts"), "export {};\n");
		const second = checkpoint(2);
		// Turn 2 (latest, compared against the working tree): edit the new file
		// and delete the README.
		writeFileSync(join(repo, "new.ts"), "export {};\nexport const x = 1;\n");
		rmSync(join(repo, "README.md"));

		const changes = await getSessionChanges(localGit(repo), repo, [
			second,
			first,
		]);

		expect(changes.lastTurn.runCount).toBe(2);
		expect(summary(changes.lastTurn.files)).toEqual([
			"M new.ts +1 -0",
			"D README.md +0 -1",
		]);
		// The pre-existing untracked note is in every snapshot, so it never shows.
		expect(summary(changes.session.files)).toEqual([
			"M a.ts +2 -1",
			"A new.ts +2 -0",
			"D README.md +0 -1",
		]);
	});

	it("reads both sides of a change from its blob ids", async () => {
		const first = checkpoint(1);
		writeFileSync(join(repo, "a.ts"), "one\nthree\n");
		const changes = await getSessionChanges(localGit(repo), repo, [first]);
		const file = changes.session.files[0];
		expect(file?.path).toBe("a.ts");
		await expect(
			readSessionChangeContents(localGit(repo), file?.oldOid, file?.newOid),
		).resolves.toEqual({
			oldText: "one\ntwo\n",
			newText: "one\nthree\n",
			binary: false,
			truncated: false,
		});
	});

	it("does not touch the real index", async () => {
		const first = checkpoint(1);
		writeFileSync(join(repo, "new.ts"), "export {};\n");
		await getSessionChanges(localGit(repo), repo, [first]);
		expect(git("status", "--porcelain")).toBe("?? new.ts");
	});

	it("flags binary contents and rejects malformed object ids", async () => {
		const first = checkpoint(1);
		writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2]));
		const changes = await getSessionChanges(localGit(repo), repo, [first]);
		const file = changes.session.files[0];
		expect(file).toMatchObject({
			path: "blob.bin",
			status: "A",
			additions: null,
		});
		await expect(
			readSessionChangeContents(localGit(repo), undefined, file?.newOid),
		).resolves.toMatchObject({ binary: true, newText: "" });
		await expect(
			readSessionChangeContents(localGit(repo), "--output=/tmp/x", undefined),
		).rejects.toThrow(/Invalid object id/);
	});
});
