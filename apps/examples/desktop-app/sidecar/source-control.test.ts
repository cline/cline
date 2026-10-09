import { execFile } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	countLines,
	type GitRunner,
	getGitFileDiff,
	getSourceControlState,
	parseLog,
	parseNumstat,
	parseSourceControlAction,
	parseStatus,
	runSourceControlAction,
} from "./source-control";

const execFileAsync = promisify(execFile);

describe("parseStatus", () => {
	it("splits index and worktree changes and reads the branch header", () => {
		const output = [
			"## feature...origin/feature [ahead 2, behind 1]",
			"M  staged.ts",
			" M dirty.ts",
			"MM both.ts",
			"A  added.ts",
			"?? new.txt",
			"R  renamed.ts",
			"old.ts",
			"UU conflict.ts",
		].join("\0");
		const status = parseStatus(output);
		expect(status.branch).toBe("feature");
		expect(status.hasUpstream).toBe(true);
		expect(status.ahead).toBe(2);
		expect(status.behind).toBe(1);
		expect(status.staged).toEqual([
			{ path: "staged.ts", status: "M" },
			{ path: "both.ts", status: "M" },
			{ path: "added.ts", status: "A" },
			{ path: "renamed.ts", originalPath: "old.ts", status: "R" },
		]);
		expect(status.unstaged).toEqual([
			{ path: "dirty.ts", status: "M" },
			{ path: "both.ts", status: "M" },
			{ path: "conflict.ts", status: "U" },
		]);
		expect(status.untracked).toEqual(["new.txt"]);
	});

	it("handles a branch without upstream and detached heads", () => {
		expect(parseStatus("## main")).toMatchObject({
			branch: "main",
			hasUpstream: false,
			ahead: 0,
		});
		expect(parseStatus("## HEAD (no branch)").branch).toBeNull();
		expect(parseStatus("## No commits yet on main").branch).toBe("main");
	});
});

describe("parseNumstat", () => {
	it("reads counts, binary markers, and renames", () => {
		const output = [
			"3\t1\ta.ts",
			"-\t-\timg.png",
			"5\t0\t",
			"old.ts",
			"new.ts",
			"",
		].join("\0");
		const counts = parseNumstat(output);
		expect(counts.get("a.ts")).toEqual({ additions: 3, deletions: 1 });
		expect(counts.get("img.png")).toEqual({ additions: null, deletions: null });
		expect(counts.get("new.ts")).toEqual({ additions: 5, deletions: 0 });
	});

	it("keeps tabs inside filenames", () => {
		const counts = parseNumstat("1\t2\tweird\tname.txt\0");
		expect(counts.get("weird\tname.txt")).toEqual({
			additions: 1,
			deletions: 2,
		});
	});
});

describe("parseLog", () => {
	it("marks commits ahead of upstream as unpushed", () => {
		const output =
			"aaa\x1fa\x1fFirst\x1f2 hours ago\x1e\nbbb\x1fb\x1fSecond\x1f1 day ago\x1e\n";
		const commits = parseLog(output, new Set(["aaa"]), true);
		expect(commits.map((c) => [c.shortSha, c.pushed])).toEqual([
			["a", false],
			["b", true],
		]);
		// Without an upstream nothing counts as published.
		expect(parseLog(output, new Set(), false).some((c) => c.pushed)).toBe(
			false,
		);
	});
});

describe("countLines", () => {
	it("counts a trailing newline as the end of the last line", () => {
		expect(countLines("")).toBe(0);
		expect(countLines("a\nb\n")).toBe(2);
		expect(countLines("a\nb")).toBe(2);
	});
});

describe("parseSourceControlAction", () => {
	it("accepts the known actions and rejects the rest", () => {
		expect(
			parseSourceControlAction({ type: "stage", paths: ["a", 1, ""] }),
		).toEqual({
			type: "stage",
			paths: ["a"],
		});
		expect(
			parseSourceControlAction({ type: "commit", message: "m", push: true }),
		).toEqual({
			type: "commit",
			message: "m",
			push: true,
		});
		expect(() => parseSourceControlAction({ type: "rebase" })).toThrow(
			/Unknown/,
		);
	});
});

describe("against a real repository", () => {
	let root: string;
	let git: GitRunner;
	const readWorking = async (path: string) => ({
		content: readFileSync(join(root, path), "utf8"),
		truncated: false,
	});

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "cline-source-control-"));
		git = async (args) =>
			(await execFileAsync("git", args, { cwd: root, encoding: "utf8" }))
				.stdout;
		await git(["init", "-q", "-b", "main"]);
		await git(["config", "user.email", "test@example.com"]);
		await git(["config", "user.name", "Test"]);
		await git(["config", "commit.gpgsign", "false"]);
		writeFileSync(join(root, "a.ts"), "one\ntwo\n");
		writeFileSync(join(root, "b.ts"), "keep\n");
		await git(["add", "."]);
		await git(["commit", "-q", "-m", "initial"]);
		writeFileSync(join(root, "a.ts"), "one\nchanged\nthree\n");
		writeFileSync(join(root, "b.ts"), "keep\nstaged\n");
		await git(["add", "b.ts"]);
		writeFileSync(join(root, "new.txt"), "x\ny\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("reports staged, unstaged, and untracked files with counts and history", async () => {
		const state = await getSourceControlState(git, "local", {
			readUntracked: async (path) => readFileSync(join(root, path), "utf8"),
		});
		expect(state.branch).toBe("main");
		expect(state.hasUpstream).toBe(false);
		expect(state.staged).toEqual([
			{ path: "b.ts", status: "M", additions: 1, deletions: 0 },
		]);
		expect(state.unstaged).toEqual([
			{ path: "a.ts", status: "M", additions: 2, deletions: 1 },
		]);
		expect(state.untracked).toEqual([
			{ path: "new.txt", status: "?", additions: 2, deletions: 0 },
		]);
		expect(state.commits).toHaveLength(1);
		expect(state.commits[0]?.subject).toBe("initial");
	});

	it("returns an empty state outside a repository", async () => {
		const outside = mkdtempSync(join(tmpdir(), "cline-not-a-repo-"));
		const noRepo: GitRunner = async (args) =>
			(await execFileAsync("git", args, { cwd: outside, encoding: "utf8" }))
				.stdout;
		try {
			expect((await getSourceControlState(noRepo, "local")).root).toBeNull();
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("diffs the working tree against the index and the index against HEAD", async () => {
		const read = readWorking;
		const worktree = await getGitFileDiff(git, read, "local", "a.ts", false);
		expect(worktree.oldText).toBe("one\ntwo\n");
		expect(worktree.newText).toBe("one\nchanged\nthree\n");
		const staged = await getGitFileDiff(git, read, "local", "b.ts", true);
		expect(staged.oldText).toBe("keep\n");
		expect(staged.newText).toBe("keep\nstaged\n");
		const untracked = await getGitFileDiff(
			git,
			read,
			"local",
			"new.txt",
			false,
		);
		expect(untracked.oldText).toBeUndefined();
		expect(untracked.newText).toBe("x\ny\n");
	});

	it("tracks staged renames back to their original path", async () => {
		const read = readWorking;
		// a.ts has unstaged edits; move the committed version so git sees a
		// pure rename in the index.
		await git(["checkout", "--", "a.ts"]);
		await git(["mv", "a.ts", "renamed.ts"]);
		let state = await getSourceControlState(git, "local");
		const renamed = state.staged.find((file) => file.path === "renamed.ts");
		expect(renamed?.originalPath).toBe("a.ts");

		const diff = await getGitFileDiff(
			git,
			read,
			"local",
			"renamed.ts",
			true,
			"a.ts",
		);
		expect(diff.oldText).toBe("one\ntwo\n");
		expect(diff.newText).toBe("one\ntwo\n");

		await runSourceControlAction(git, {
			type: "unstage",
			paths: ["renamed.ts", "a.ts"],
		});
		state = await getSourceControlState(git, "local");
		expect(state.staged.map((file) => file.path)).toEqual(["b.ts"]);
		expect(state.unstaged.map((file) => [file.path, file.status])).toEqual([
			["a.ts", "D"],
		]);
		expect(state.untracked.map((file) => file.path)).toEqual([
			"new.txt",
			"renamed.ts",
		]);
	});

	it("flags a staged change as binary when either side has NUL bytes", async () => {
		const read = readWorking;
		writeFileSync(join(root, "b.ts"), Buffer.from([0x62, 0x00, 0x69, 0x6e]));
		await git(["add", "b.ts"]);
		const diff = await getGitFileDiff(git, read, "local", "b.ts", true);
		expect(diff.oldText).toBe("keep\n");
		expect(diff.binary).toBe(true);
	});

	it("previews an unstaged deletion and flags truncated working copies", async () => {
		rmSync(join(root, "a.ts"));
		const deleted = await getGitFileDiff(
			git,
			async () => ({ content: "", truncated: false }),
			"local",
			"a.ts",
			false,
		);
		expect(deleted.oldText).toBe("one\ntwo\n");
		expect(deleted.newText).toBe("");
		const truncated = await getGitFileDiff(
			git,
			async () => ({ content: "one\n", truncated: true }),
			"local",
			"new.txt",
			false,
		);
		expect(truncated.truncated).toBe(true);
	});

	it("treats filenames literally when staging and discarding", async () => {
		writeFileSync(join(root, "draft*.txt"), "glob\n");
		writeFileSync(join(root, "draft1.txt"), "keep me\n");
		await runSourceControlAction(git, { type: "stage", paths: ["draft*.txt"] });
		let state = await getSourceControlState(git, "local");
		expect(state.staged.map((file) => file.path)).toEqual([
			"b.ts",
			"draft*.txt",
		]);
		expect(state.untracked.map((file) => file.path)).toContain("draft1.txt");
		await runSourceControlAction(git, {
			type: "unstage",
			paths: ["draft*.txt"],
		});
		await runSourceControlAction(git, {
			type: "discard",
			paths: [],
			untrackedPaths: ["draft*.txt"],
		});
		state = await getSourceControlState(git, "local");
		expect(existsSync(join(root, "draft*.txt"))).toBe(false);
		expect(existsSync(join(root, "draft1.txt"))).toBe(true);
	});

	it("unstages before the first commit by dropping index entries", async () => {
		const fresh = mkdtempSync(join(tmpdir(), "cline-first-commit-"));
		const freshGit: GitRunner = async (args) =>
			(await execFileAsync("git", args, { cwd: fresh, encoding: "utf8" }))
				.stdout;
		try {
			await freshGit(["init", "-q", "-b", "main"]);
			writeFileSync(join(fresh, "first.ts"), "hello\n");
			await runSourceControlAction(freshGit, {
				type: "stage",
				paths: ["first.ts"],
			});
			expect(
				(await getSourceControlState(freshGit, "local")).staged,
			).toHaveLength(1);
			await runSourceControlAction(freshGit, {
				type: "unstage",
				paths: ["first.ts"],
			});
			const state = await getSourceControlState(freshGit, "local");
			expect(state.staged).toEqual([]);
			expect(state.untracked.map((file) => file.path)).toEqual(["first.ts"]);
			expect(existsSync(join(fresh, "first.ts"))).toBe(true);
		} finally {
			rmSync(fresh, { recursive: true, force: true });
		}
	});

	it("stages, unstages, discards, and commits", async () => {
		await runSourceControlAction(git, {
			type: "stage",
			paths: ["a.ts", "new.txt"],
		});
		let state = await getSourceControlState(git, "local");
		expect(state.staged.map((f) => f.path)).toEqual([
			"a.ts",
			"b.ts",
			"new.txt",
		]);
		expect(state.unstaged).toEqual([]);

		await runSourceControlAction(git, { type: "unstage", paths: ["a.ts"] });
		state = await getSourceControlState(git, "local");
		expect(state.unstaged.map((f) => f.path)).toEqual(["a.ts"]);

		await runSourceControlAction(git, {
			type: "discard",
			paths: ["a.ts"],
			untrackedPaths: [],
		});
		expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("one\ntwo\n");

		await runSourceControlAction(git, {
			type: "commit",
			message: "add staged work",
			push: false,
		});
		state = await getSourceControlState(git, "local");
		expect(state.staged).toEqual([]);
		expect(state.commits[0]?.subject).toBe("add staged work");
		await expect(
			runSourceControlAction(git, {
				type: "commit",
				message: "  ",
				push: false,
			}),
		).rejects.toThrow(/message/);
	});
});
