import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyHandoffGit,
	inspectHandoffGit,
	verifyPublishedHandoffGit,
} from "./git-preparation";

const transport = vi.hoisted(() => ({
	remote: "",
	fetchUrl: "https://github.com/cline/todo-app",
	pushUrl: "https://github.com/cline/todo-app",
	rejectFetch: false,
	rejection: new Error("rejected: synthetic-private-token"),
	beforeFetch: () => {},
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
		if (args[0] === "fetch" && transport.rejectFetch) {
			queueMicrotask(() => callback(transport.rejection, "", ""));
			return { stdin: null };
		}
		const mapped = [...args];
		if (args[0] === "fetch") transport.beforeFetch();
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
	const config = join(temporary, "gitconfig");
	writeFileSync(config, "");
	vi.stubEnv("GIT_CONFIG_GLOBAL", config);
	vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
	repo = join(temporary, "repo");
	mkdirSync(repo);
	transport.remote = join(temporary, "remote.git");
	transport.fetchUrl = transport.pushUrl = "https://github.com/cline/todo-app";
	transport.rejectFetch = false;
	transport.rejection = new Error("rejected: synthetic-private-token");
	transport.beforeFetch = () => {};
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
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(temporary, { recursive: true, force: true });
});

describe("cloud handoff Git preparation", () => {
	it.each([
		["outside a repository", "Open a Git repository"],
		["detached HEAD", "Check out a Git branch"],
	])("explains preparation %s", async (state, guidance) => {
		if (state === "detached HEAD") git("checkout", "--detach", "HEAD");
		await expect(
			inspectHandoffGit(state === "detached HEAD" ? repo : temporary),
		).rejects.toThrow(guidance);
	});
	it("keeps a symlinked workspace relative to the repository", async () => {
		mkdirSync(join(repo, "packages", "app"), { recursive: true });
		const linked = join(temporary, "linked");
		symlinkSync(repo, linked, "junction");
		const plan = await inspectHandoffGit(join(linked, "packages", "app"));
		expect(plan.workspaceRelativePath).toBe("packages/app");
	});
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

	it("does not fetch already-local published ancestry", async () => {
		writeFileSync(
			join(repo, "credentials.json"),
			"synthetic published content\n",
		);
		git("add", ".");
		git("commit", "-m", "published change");
		const source = git("rev-parse", "HEAD");
		git("commit", "--allow-empty", "-m", "published descendant");
		git("push", "origin", "main");
		git("switch", "-c", "work", source);
		writeFileSync(join(repo, "new.txt"), "local change\n");
		transport.rejectFetch = true;
		const plan = await inspectHandoffGit(repo);
		expect(plan.commits).toEqual([]);
		expect(plan.files).toEqual([{ path: "new.txt", status: "??" }]);
		expect(git("rev-parse", "HEAD")).toBe(source);
	});
	it("excludes published sensitive history when the remote advances beyond local objects", async () => {
		const path = "credentials.json";
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

	it.each([
		[{ code: 128 }, "Git fetch failed (exit code 128)"],
		[{ code: null, killed: true }, "Git fetch timed out after 60 seconds"],
		[
			{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true },
			"Git fetch failed",
		],
	])("stops preparation with safe diagnostics when fetching fails (%j)", async (details, message) => {
		git("commit", "--allow-empty", "-m", "local only");
		transport.rejectFetch = true;
		Object.assign(transport.rejection, details);
		const refs = git("show-ref");
		const index = git("write-tree");
		const result = inspectHandoffGit(repo);
		await expect(result).rejects.toThrow(message);
		await expect(result).rejects.not.toThrow("synthetic-private-token");
		expect(git("show-ref")).toBe(refs);
		expect(git("write-tree")).toBe(index);
		expect(git("status", "--porcelain")).toBe("");
	});

	it.each([
		false,
		true,
	])("checks only new sensitive merge content (new resolution: %s)", async (newResolution) => {
		git("switch", "-c", "published");
		writeFileSync(
			join(repo, "credentials.json"),
			"synthetic published value\n",
		);
		git("add", ".");
		git("commit", "-m", "published credentials");
		git("push", "origin", "published");
		git("switch", "main");
		writeFileSync(join(repo, "tracked.txt"), "local change\n");
		git("commit", "-am", "local change");
		git("merge", "--no-ff", "--no-commit", "published");
		if (newResolution) {
			writeFileSync(
				join(repo, "credentials.json"),
				"synthetic unpublished value\n",
			);
			git("add", "credentials.json");
		}
		git("commit", "-m", "merge published");
		const remoteRefs = git("ls-remote", "origin");
		if (newResolution) {
			await expect(inspectHandoffGit(repo)).rejects.toThrow(
				"unpublished history",
			);
			expect(git("ls-remote", "origin")).toBe(remoteRefs);
		} else {
			const plan = await inspectHandoffGit(repo);
			expect(plan.commits).toEqual([
				expect.stringContaining("merge published"),
				expect.stringContaining("local change"),
			]);
			await applyHandoffGit(plan);
			expect(
				git(
					"--git-dir",
					transport.remote,
					"show",
					`${plan.branch}:credentials.json`,
				),
			).toBe("synthetic published value");
		}
	});

	it.each([
		["--skip-worktree", false],
		["--assume-unchanged", false],
		["--skip-worktree", true],
		["--assume-unchanged", true],
	] as const)("never publishes hidden %s changes (after preview: %s)", async (flag, afterPreview) => {
		const credentials = join(repo, "credentials.json");
		writeFileSync(credentials, "synthetic baseline\n");
		git("add", "credentials.json");
		git("commit", "-m", "synthetic baseline");
		git("push", "origin", "main");
		writeFileSync(join(repo, "new.txt"), "visible change\n");
		const plan = afterPreview ? await inspectHandoffGit(repo) : undefined;
		git("update-index", flag, "credentials.json");
		const localContent = "synthetic local-only value\n";
		writeFileSync(credentials, localContent);
		expect(git("status", "--porcelain")).toBe("?? new.txt");
		const head = git("rev-parse", "HEAD");
		const index = readFileSync(join(repo, ".git/index"));
		const remoteRefs = git("ls-remote", "origin");

		if (plan) {
			await applyHandoffGit(plan);
			expect(
				git(
					"--git-dir",
					transport.remote,
					"show",
					`${plan.branch}:credentials.json`,
				),
			).toBe("synthetic baseline");
		} else {
			await expect(inspectHandoffGit(repo)).rejects.toThrow(
				"skip-worktree or assume-unchanged",
			);
			expect(git("ls-remote", "origin")).toBe(remoteRefs);
		}

		expect(git("branch", "--show-current")).toBe("main");
		expect(git("rev-parse", "HEAD")).toBe(head);
		expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
		expect(readFileSync(credentials, "utf8")).toBe(localContent);
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe(
			"visible change\n",
		);
	});

	it("publishes staged, unstaged, and new files from a subdirectory without changing the source checkout", async () => {
		writeFileSync(join(repo, "tracked.txt"), "staged\n");
		git("add", ".");
		writeFileSync(join(repo, "tracked.txt"), "working copy\n");
		writeFileSync(join(repo, "new file.txt"), "new\n");
		mkdirSync(join(repo, "sub"));
		const beforeIndex = git("write-tree");
		const originalHead = git("rev-parse", "HEAD");
		const originalStatus = git("status", "--porcelain");
		const originalRefs = git("show-ref", "--heads", "--tags");
		const originalConfig = readFileSync(join(repo, ".git/config"));
		transport.pushUrl = "https://synthetic-token@github.com/cline/todo-app";
		transport.rejectFetch = true;
		const plan = await inspectHandoffGit(join(repo, "sub"));
		expect(plan.files.map((file) => file.path).sort()).toEqual([
			"new file.txt",
			"tracked.txt",
		]);
		expect(plan.commits).toEqual([]);
		expect(git("write-tree")).toBe(beforeIndex);
		expect(git("branch", "--show-current")).toBe("main");
		expect(plan).not.toHaveProperty("pushUrl");
		transport.pushUrl = "git@github.com:cline/todo-app.git";
		const published = await applyHandoffGit(plan);
		expect(git("status", "--porcelain")).toBe(originalStatus);
		expect(git("write-tree")).toBe(beforeIndex);
		expect(git("branch", "--show-current")).toBe("main");
		expect(git("rev-parse", "main")).toBe(originalHead);
		expect(git("rev-parse", `${published}^{tree}`)).toBe(plan.treeSha);
		expect(git("rev-parse", `${published}^`)).toBe(originalHead);
		expect(
			git("worktree", "list", "--porcelain").match(/^worktree /gm),
		).toHaveLength(1);
		await verifyPublishedHandoffGit(plan, published);
		expect(git("show-ref", "--heads", "--tags")).toBe(originalRefs);
		expect(readFileSync(join(repo, ".git/config"))).toEqual(originalConfig);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("working copy");
		expect(git("show", ":tracked.txt")).toBe("staged");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			"working copy\n",
		);
		git(
			"--git-dir",
			transport.remote,
			"update-ref",
			`refs/heads/${plan.branch}`,
			originalHead,
		);
		await expect(verifyPublishedHandoffGit(plan, published)).rejects.toThrow(
			"published branch changed",
		);
	});

	it("publishes only the captured files while local commits and edits continue", async () => {
		writeFileSync(join(repo, "tracked.txt"), "approved");
		const plan = await inspectHandoffGit(repo);
		writeFileSync(join(repo, "tracked.txt"), "later committed work");
		git("add", ".");
		git("commit", "-m", "another commit");
		const head = git("rev-parse", "HEAD");
		writeFileSync(join(repo, "tracked.txt"), "later staged work");
		git("add", ".");
		const index = git("write-tree");
		writeFileSync(join(repo, "tracked.txt"), "later unstaged work");
		const published = await applyHandoffGit(plan);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("approved");
		expect(git("rev-parse", `${published}^`)).toBe(plan.headSha);
		expect(git("rev-parse", "HEAD")).toBe(head);
		expect(git("write-tree")).toBe(index);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			"later unstaged work",
		);
		expect(git("branch", "--show-current")).toBe("main");
	});

	it("captures file contents before remote inspection while local edits continue", async () => {
		git("commit", "--allow-empty", "-m", "local only");
		writeFileSync(join(repo, "tracked.txt"), "captured with conversation\n");
		const captured = vi.fn();
		transport.beforeFetch = () => {
			expect(captured).toHaveBeenCalledOnce();
			writeFileSync(join(repo, "tracked.txt"), "later local turn\n");
		};
		const plan = await inspectHandoffGit(repo, captured);
		await applyHandoffGit(plan);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("captured with conversation");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			"later local turn\n",
		);
	});

	it.each([
		{ fetchUrl: "https://github.com/cline/another" },
		{ pushUrl: "https://github.com/cline/another" },
		{
			fetchUrl:
				"https://github.com/cline/todo-app#fragment\nhttps://github.com/cline/another",
		},
		{
			pushUrl:
				"https://github.com/cline/todo-app#fragment\nhttps://github.com/cline/another",
		},
	])("rejects changed or multiple publication destinations: %j", async (changed) => {
		const plan = await inspectHandoffGit(repo);
		Object.assign(transport, changed);
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

	it("preserves local refs, configuration, and files after a pre-push rejection", async () => {
		writeFileSync(join(repo, "tracked.txt"), "keep this");
		const plan = await inspectHandoffGit(repo);
		writeFileSync(
			join(repo, ".git/hooks/pre-push"),
			"#!/bin/sh\necho synthetic-private-token >&2\nexit 1\n",
			{ mode: 0o755 },
		);
		const refs = git("show-ref");
		const config = readFileSync(join(repo, ".git/config"));
		const result = applyHandoffGit(plan);
		await expect(result).rejects.toThrow("Couldn't complete the push");
		await expect(result).rejects.not.toThrow("synthetic-private-token");
		expect(git("branch", "--show-current")).toBe("main");
		expect(git("show-ref")).toBe(refs);
		expect(readFileSync(join(repo, ".git/config"))).toEqual(config);
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("keep this");
		expect(git("ls-remote", "origin", `refs/heads/${plan.branch}`)).toBe("");
	});

	it("publishes an unsigned snapshot without commit or checkout hooks", async () => {
		writeFileSync(join(repo, "tracked.txt"), "approved\n");
		const plan = await inspectHandoffGit(repo);
		for (const hook of ["pre-commit", "post-checkout"]) {
			writeFileSync(join(repo, ".git/hooks", hook), "#!/bin/sh\nexit 1\n", {
				mode: 0o755,
			});
		}
		git("config", "commit.gpgsign", "true");
		git("config", "gpg.program", join(temporary, "missing-signer"));
		const published = await applyHandoffGit(plan);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("approved");
		expect(git("cat-file", "-p", published)).not.toContain("\ngpgsig ");
		expect(git("branch", "--list", plan.branch)).toBe("");
		expect(git("branch", "--show-current")).toBe("main");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe("approved\n");
	});

	it("runs pre-push with local tooling and the captured SHA while the source changes", async () => {
		writeFileSync(join(repo, ".gitignore"), ".hooks/\nnode_modules/\n");
		git("add", ".gitignore");
		git("commit", "-m", "ignore generated hooks");
		mkdirSync(join(repo, ".hooks"));
		mkdirSync(join(repo, "node_modules/.bin"), { recursive: true });
		writeFileSync(
			join(repo, "node_modules/.bin/check"),
			"#!/bin/sh\necho tool-available\n",
			{
				mode: 0o755,
			},
		);
		writeFileSync(
			join(repo, ".hooks/pre-push"),
			'#!/bin/sh\n./node_modules/.bin/check > .git/hook-observation || exit 1\nread local_ref local_sha remote_ref remote_sha\ngit show "$local_sha:tracked.txt" >> .git/hook-observation\ncat tracked.txt >> .git/hook-observation\n',
			{
				mode: 0o755,
			},
		);
		git("config", "core.hooksPath", ".hooks");
		writeFileSync(join(repo, "tracked.txt"), "approved\n");
		const plan = await inspectHandoffGit(repo);
		writeFileSync(join(repo, "tracked.txt"), "later local work\n");
		await applyHandoffGit(plan);
		expect(
			git("--git-dir", transport.remote, "show", `${plan.branch}:tracked.txt`),
		).toBe("approved");
		expect(readFileSync(join(repo, ".git/hook-observation"), "utf8")).toBe(
			"tool-available\napproved\nlater local work\n",
		);
		expect(git("branch", "--show-current")).toBe("main");
		expect(readFileSync(join(repo, "tracked.txt"), "utf8")).toBe(
			"later local work\n",
		);
	});

	it.each([
		".env",
		"secret.key",
		".npmrc",
		".yarnrc.yml",
		".netrc",
		".pgpass",
		".pypirc",
		".aws/credentials",
		"release.jks",
		"release.keystore",
	])("blocks potential secret %s without staging it", async (name) => {
		mkdirSync(dirname(join(repo, name)), { recursive: true });
		writeFileSync(join(repo, name), "private");
		await expect(inspectHandoffGit(repo)).rejects.toThrow("sensitive files");
		expect(git("diff", "--cached", "--name-only")).toBe("");
	});

	it.each([
		[".env", false],
		[".env", true],
		[".npmrc", true],
		[".aws/credentials", true],
		[".env", true, "replace"],
		[".env", true, "graft"],
	] as const)("rejects sensitive unpublished %s history (deleted later: %s, overlay: %s) without mutation", async (path, deleted, overlay?:
		| "replace"
		| "graft") => {
		mkdirSync(dirname(join(repo, path)), { recursive: true });
		writeFileSync(join(repo, path), "SYNTHETIC_LOCAL_ONLY=value\n");
		git("add", path);
		git("commit", "-m", "local credentials");
		if (deleted) {
			git("rm", path);
			git("commit", "-m", "remove credentials");
		}
		const head = git("rev-parse", "HEAD");
		if (overlay === "replace") {
			git("replace", "--graft", head, "origin/main");
		} else if (overlay === "graft") {
			writeFileSync(
				join(repo, ".git/info/grafts"),
				`${head} ${git("rev-parse", "origin/main")}\n`,
			);
		}
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

	it("publishes credential templates but excludes ignored files", async () => {
		writeFileSync(join(repo, ".netrc.example"), "machine example.com\n");
		writeFileSync(join(repo, ".gitignore"), "private.txt\n");
		writeFileSync(join(repo, "private.txt"), "keep local");
		const plan = await inspectHandoffGit(repo);
		expect(plan.files.map((file) => file.path)).toEqual([
			".gitignore",
			".netrc.example",
		]);
		await applyHandoffGit(plan);
		expect(
			git(
				"--git-dir",
				transport.remote,
				"ls-tree",
				"-r",
				"--name-only",
				plan.branch,
			),
		).toBe(".gitignore\n.netrc.example\ntracked.txt");
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
