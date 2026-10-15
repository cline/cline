import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyHandoffGit,
	inspectHandoffGit,
	previewHandoffGit,
} from "./cloud-handoff-git";

const transport = vi.hoisted(() => ({
	remote: "",
	fetchUrl: "https://github.com/cline/todo-app",
	pushUrl: "https://github.com/cline/todo-app",
	rejectPush: false,
	rejectFetch: false,
}));
vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	const run = (
		file: string,
		args: string[],
		options: object,
		callback: (error: Error | null, stdout: string, stderr: string) => void,
	) => {
		if (args.join(" ").length >= 32_767) {
			queueMicrotask(() =>
				callback(new Error("Windows command-line limit"), "", ""),
			);
			return { stdin: null };
		}
		if (args[0] === "remote" && args[1] === "get-url") {
			queueMicrotask(() =>
				callback(
					null,
					args.includes("--push") ? transport.pushUrl : transport.fetchUrl,
					"",
				),
			);
			return;
		}
		const push = args.indexOf("push");
		if (
			(push >= 0 && transport.rejectPush) ||
			(args[0] === "fetch" && transport.rejectFetch)
		) {
			queueMicrotask(() =>
				callback(new Error("rejected: synthetic-private-token"), "", ""),
			);
			return { stdin: null };
		}
		const mapped = [...args];
		if (push >= 0) mapped[push + 1] = transport.remote;
		return actual.execFile(file, mapped, options, callback);
	};
	return { ...actual, execFile: run };
});

let temporary: string;
let repo: string;
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
beforeEach(() => {
	temporary = mkdtempSync(join(tmpdir(), "handoff-git-test-"));
	repo = join(temporary, "repo");
	mkdirSync(repo);
	transport.remote = join(temporary, "remote.git");
	transport.fetchUrl = transport.pushUrl = "https://github.com/cline/todo-app";
	transport.rejectPush = false;
	transport.rejectFetch = false;
	git("init", "-b", "main");
	git("config", "user.email", "qa@example.com");
	git("config", "user.name", "QA");
	writeFileSync(join(repo, "tracked.txt"), "original\n");
	git("add", ".");
	git("commit", "-m", "initial");
	git("init", "--bare", transport.remote);
	git("remote", "add", "origin", transport.remote);
	git("push", "-u", "origin", "main");
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

describe("cloud handoff Git preparation", () => {
	it("inspects large remotes without exceeding Windows command-line limits", async () => {
		const head = git("rev-parse", "HEAD");
		execFileSync(
			"git",
			["--git-dir", transport.remote, "update-ref", "--stdin"],
			{
				input: Array.from(
					{ length: 800 },
					(_, i) => `create refs/heads/test-${i} ${head}\n`,
				).join(""),
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		git("commit", "--allow-empty", "-m", "local only");
		const refs = git("show-ref");
		const remoteRefs = git("ls-remote", "origin");
		const plan = await inspectHandoffGit(repo);
		expect(plan.commits).toEqual([
			`${git("rev-parse", "--short", "HEAD")} local only`,
		]);
		expect(git("show-ref")).toBe(refs);
		expect(git("ls-remote", "origin")).toBe(remoteRefs);
	});

	it.each([
		"tracked.txt",
		"credentials.json",
	])("excludes published %s history when the remote advances beyond local objects", async (path) => {
		writeFileSync(join(repo, path), "synthetic published content\n");
		git("add", path);
		git("commit", "-m", "published change");
		git("push", "origin", "main");
		const other = join(temporary, "other");
		git("clone", "--branch", "main", transport.remote, other);
		git(
			"-C",
			other,
			"-c",
			"user.name=QA",
			"-c",
			"user.email=qa@example.com",
			"commit",
			"--allow-empty",
			"-m",
			"remote advance",
		);
		git("-C", other, "push", "origin", "main");
		const remoteHead = git("-C", other, "rev-parse", "HEAD");
		expect(() => git("cat-file", "-e", remoteHead)).toThrow();
		writeFileSync(join(repo, "new.txt"), "local change\n");
		writeFileSync(join(repo, ".git/FETCH_HEAD"), "preserve fetch state\n");
		git("config", "fetch.prune", "true");
		git("config", "fetch.pruneTags", "true");
		git("tag", "local-only");
		const refs = git("show-ref");
		const index = git("write-tree");
		const status = git("status", "--porcelain");
		const remoteRefs = git("ls-remote", "origin");

		const plan = await inspectHandoffGit(repo);

		expect(plan.commits).toEqual([]);
		expect(plan.files.map((file) => file.path)).toEqual(["new.txt"]);
		expect(git("cat-file", "-t", remoteHead)).toBe("commit");
		expect(git("show-ref")).toBe(refs);
		expect(git("write-tree")).toBe(index);
		expect(git("status", "--porcelain")).toBe(status);
		expect(git("branch", "--show-current")).toBe("main");
		expect(readFileSync(join(repo, ".git/FETCH_HEAD"), "utf8")).toBe(
			"preserve fetch state\n",
		);
		expect(git("ls-remote", "origin")).toBe(remoteRefs);
	});

	it("stops preparation when remote objects cannot be fetched", async () => {
		transport.rejectFetch = true;
		const refs = git("show-ref");
		const index = git("write-tree");
		await expect(inspectHandoffGit(repo)).rejects.toThrow("Git fetch failed");
		expect(git("show-ref")).toBe(refs);
		expect(git("write-tree")).toBe(index);
		expect(git("status", "--porcelain")).toBe("");
	});

	it.each([
		["--skip-worktree", false],
		["--assume-unchanged", false],
		["--skip-worktree", true],
		["--assume-unchanged", true],
	] as const)("rejects %s (after preview: %s) without changing Git state", async (flag, afterPreview) => {
		const credentials = join(repo, "credentials.json");
		writeFileSync(credentials, "synthetic baseline\n");
		git("add", "credentials.json");
		git("commit", "-m", "synthetic baseline");
		git("push", "origin", "main");
		writeFileSync(join(repo, "new.txt"), "visible change\n");
		const plan = afterPreview ? await inspectHandoffGit(repo) : undefined;
		git("update-index", flag, "credentials.json");
		const localContent = afterPreview
			? "synthetic baseline\n"
			: "synthetic local-only value\n";
		writeFileSync(credentials, localContent);
		expect(git("status", "--porcelain")).toBe("?? new.txt");
		const head = git("rev-parse", "HEAD");
		const index = readFileSync(join(repo, ".git/index"));
		const remoteRefs = git("ls-remote", "origin");

		await expect(
			plan ? applyHandoffGit(plan) : inspectHandoffGit(repo),
		).rejects.toThrow("skip-worktree or assume-unchanged");

		expect(git("branch", "--show-current")).toBe("main");
		expect(git("rev-parse", "HEAD")).toBe(head);
		expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
		expect(readFileSync(credentials, "utf8")).toBe(localContent);
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe(
			"visible change\n",
		);
		expect(git("ls-remote", "origin")).toBe(remoteRefs);
	});

	it("previews all staged/unstaged/new files from a subdirectory without changing the index or branch, then publishes the exact checkpoint", async () => {
		writeFileSync(join(repo, "tracked.txt"), "staged\n");
		git("add", ".");
		writeFileSync(join(repo, "unstaged.txt"), "working\n");
		writeFileSync(join(repo, "new file.txt"), "new\n");
		mkdirSync(join(repo, "sub"));
		const beforeIndex = git("write-tree");
		const originalHead = git("rev-parse", "HEAD");
		const plan = await inspectHandoffGit(join(repo, "sub"));
		expect(plan.files.map((file) => file.path).sort()).toEqual([
			"new file.txt",
			"tracked.txt",
			"unstaged.txt",
		]);
		expect(plan.commits).toEqual([]);
		expect(git("write-tree")).toBe(beforeIndex);
		expect(git("branch", "--show-current")).toBe("main");
		expect(previewHandoffGit(plan)).not.toHaveProperty("pushUrl");
		await applyHandoffGit(plan);
		expect(git("status", "--porcelain")).toBe("");
		expect(git("rev-parse", "main")).toBe(originalHead);
		expect(git("rev-parse", "HEAD^{tree}")).toBe(plan.treeSha);
		expect(git("rev-parse", "HEAD^")).toBe(originalHead);
		expect(git("config", `branch.${plan.branch}.merge`)).toBe(
			`refs/heads/${plan.branch}`,
		);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("staged");
	});

	it("rejects distinct staged and working copies without overwriting either", async () => {
		writeFileSync(join(repo, "tracked.txt"), "staged only\n");
		git("add", "tracked.txt");
		writeFileSync(join(repo, "tracked.txt"), "working only\n");
		const index = git("write-tree");
		const refs = git("ls-remote", "origin");
		await expect(inspectHandoffGit(repo)).rejects.toThrow(
			"staged and unstaged",
		);
		expect(git("write-tree")).toBe(index);
		expect(git("show", ":tracked.txt")).toBe("staged only");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			"working only\n",
		);
		expect(git("branch", "--show-current")).toBe("main");
		expect(git("ls-remote", "origin")).toBe(refs);
	});

	it.each([
		"content",
		"index",
		"head",
		"remote",
	])("rejects stale %s consent before changing branches", async (change) => {
		writeFileSync(join(repo, "tracked.txt"), "approved");
		const plan = await inspectHandoffGit(repo);
		if (change === "content")
			writeFileSync(join(repo, "tracked.txt"), "changed with identical status");
		if (change === "index") git("add", ".");
		if (change === "head")
			git("commit", "--allow-empty", "-m", "another commit");
		if (change === "remote")
			transport.fetchUrl = transport.pushUrl =
				"https://github.com/cline/another";
		await expect(applyHandoffGit(plan)).rejects.toThrow(
			"changed after confirmation",
		);
		expect(git("branch", "--show-current")).toBe("main");
	});

	it("publishes an unpushed commit without an upstream and without an extra empty commit", async () => {
		git("switch", "-c", "local-only");
		writeFileSync(join(repo, ".env.example"), "PUBLIC_EXAMPLE=value\n");
		git("add", ".env.example");
		git("commit", "-m", "local work");
		const head = git("rev-parse", "HEAD");
		const plan = await inspectHandoffGit(repo);
		expect(plan.commits).toEqual([expect.stringContaining("local work")]);
		await applyHandoffGit(plan);
		expect(git("rev-parse", "HEAD")).toBe(head);
		expect(git("--git-dir", transport.remote, "rev-parse", plan.branch)).toBe(
			head,
		);
	});

	it("leaves the checkpoint and files intact after a rejected push", async () => {
		writeFileSync(join(repo, "tracked.txt"), "keep this");
		const plan = await inspectHandoffGit(repo);
		transport.rejectPush = true;
		await expect(applyHandoffGit(plan)).rejects.toMatchObject({
			message: `Couldn't complete the push. Your checkpoint is saved locally on ${plan.branch}. Check GitHub write access and your connection before retrying.`,
		});
		expect(git("branch", "--show-current")).toBe(plan.branch);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("keep this");
		expect(git("ls-remote", "origin", `refs/heads/${plan.branch}`)).toBe("");
	});

	it.each([
		"reject",
		"modify",
	])("does not publish after a %s hook changes the outcome", async (behavior) => {
		writeFileSync(join(repo, "tracked.txt"), "approved\n");
		writeFileSync(
			join(repo, ".git/hooks/pre-commit"),
			behavior === "reject"
				? "#!/bin/sh\nexit 1\n"
				: "#!/bin/sh\nprintf 'hook change\\n' > tracked.txt\ngit add tracked.txt\n",
			{ mode: 0o755 },
		);
		const plan = await inspectHandoffGit(repo);
		await expect(applyHandoffGit(plan)).rejects.toThrow("were not rolled back");
		expect(git("ls-remote", "origin", `refs/heads/${plan.branch}`)).toBe("");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			behavior === "reject" ? "approved\n" : "hook change\n",
		);
	});

	it.each([
		".env",
		"secret.key",
		".npmrc",
		".yarnrc.yml",
	])("blocks potential secret %s without staging it", async (name) => {
		writeFileSync(join(repo, name), "private");
		await expect(inspectHandoffGit(repo)).rejects.toThrow("sensitive files");
		expect(git("diff", "--cached", "--name-only")).toBe("");
	});

	it.each([
		[".env", false],
		[".env", true],
		[".npmrc", true],
	] as const)("rejects sensitive unpublished %s history (deleted later: %s) without mutation", async (path, deleted) => {
		writeFileSync(join(repo, path), "SYNTHETIC_LOCAL_ONLY=value\n");
		git("add", path);
		git("commit", "-m", "local credentials");
		if (deleted) {
			git("rm", path);
			git("commit", "-m", "remove credentials");
		}
		const head = git("rev-parse", "HEAD");
		const index = readFileSync(join(repo, ".git/index"));
		const remoteRefs = git("ls-remote", "origin");
		expect(git("status", "--porcelain")).toBe("");
		await expect(inspectHandoffGit(repo)).rejects.toThrow(
			"unpublished history",
		);
		expect(git("branch", "--show-current")).toBe("main");
		expect(git("rev-parse", "HEAD")).toBe(head);
		expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
		expect(git("ls-remote", "origin")).toBe(remoteRefs);
	});

	it("rejects different push repositories before any local mutation", async () => {
		transport.pushUrl = "https://github.com/other/repo";
		await expect(inspectHandoffGit(repo)).rejects.toThrow(
			"fetch and push destination",
		);
		expect(git("branch", "--show-current")).toBe("main");
	});

	it("never adds ignored files", async () => {
		writeFileSync(join(repo, ".gitignore"), "private.txt\n");
		writeFileSync(join(repo, "private.txt"), "keep local");
		const plan = await inspectHandoffGit(repo);
		expect(plan.files.map((file) => file.path)).toEqual([".gitignore"]);
		await applyHandoffGit(plan);
		expect(git("ls-tree", "-r", "--name-only", "HEAD")).not.toContain(
			"private.txt",
		);
	});
	it("refuses an untracked nested repository instead of publishing a gitlink without its files", async () => {
		const nested = join(repo, "nested");
		mkdirSync(nested);
		git("-C", nested, "init");
		git(
			"-C",
			nested,
			"-c",
			"user.name=QA",
			"-c",
			"user.email=qa@example.com",
			"commit",
			"--allow-empty",
			"-m",
			"nested work",
		);
		await expect(inspectHandoffGit(repo)).rejects.toThrow(
			"Nested Git repositories",
		);
		expect(git("diff", "--cached", "--name-only")).toBe("");
	});
});
