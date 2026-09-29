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
}));
vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	const run = (
		file: string,
		args: string[],
		options: object,
		callback: (error: Error | null, stdout: string, stderr: string) => void,
	) => {
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
		if (push >= 0 && transport.rejectPush) {
			queueMicrotask(() => callback(new Error("rejected"), "", ""));
			return;
		}
		const mapped = [...args];
		if (push >= 0) mapped[push + 1] = transport.remote;
		return actual.execFile(file, mapped, options, callback);
	};
	return {
		...actual,
		execFile: Object.assign(run, {
			[Symbol.for("nodejs.util.promisify.custom")]: (
				file: string,
				args: string[],
				options: object,
			) =>
				new Promise((resolve, reject) =>
					run(file, args, options, (error, stdout, stderr) =>
						error ? reject(error) : resolve({ stdout, stderr }),
					),
				),
		}),
	};
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
	it("previews all staged/unstaged/new files from a subdirectory without changing the index or branch, then publishes the exact checkpoint", async () => {
		writeFileSync(join(repo, "tracked.txt"), "staged\n");
		git("add", ".");
		writeFileSync(join(repo, "tracked.txt"), "working\n");
		writeFileSync(join(repo, "new file.txt"), "new\n");
		mkdirSync(join(repo, "sub"));
		const beforeIndex = git("write-tree");
		const originalHead = git("rev-parse", "HEAD");
		const plan = await inspectHandoffGit(join(repo, "sub"));
		expect(plan.files.map((file) => file.path).sort()).toEqual([
			"new file.txt",
			"tracked.txt",
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
		).toBe("working");
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
		git("commit", "--allow-empty", "-m", "local work");
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
		await expect(applyHandoffGit(plan)).rejects.toThrow("were not rolled back");
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
	])("blocks potential secret %s without staging it", async (name) => {
		writeFileSync(join(repo, name), "private");
		await expect(inspectHandoffGit(repo)).rejects.toThrow("sensitive files");
		expect(git("diff", "--cached", "--name-only")).toBe("");
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
