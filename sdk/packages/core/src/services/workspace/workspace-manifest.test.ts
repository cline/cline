import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { emptyWorkspaceManifest, upsertWorkspaceInfo } from "@cline/shared";
import simpleGit from "simple-git";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	createWorkspaceGitReader,
	generateWorkspaceInfoWithDiagnostics,
	hasCurrentSessionGitMetadata,
	readGitWorkspaceState,
	readSessionGitMetadata,
	withSessionGitMetadata,
} from "./workspace-manifest";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "workspace-manifest-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("createWorkspaceGitReader", () => {
	test("reads a nested workspace without losing path whitespace", async () => {
		const dir = await createTempDir();
		const git = simpleGit({ baseDir: dir });
		await git.init();
		await git.addConfig("user.email", "test@example.com");
		await git.addConfig("user.name", "Test");
		await git.commit("initial", ["--allow-empty"]);
		const cwd = join(dir, " leading");
		await mkdir(cwd);
		const reader = createWorkspaceGitReader({ cwd });

		expect(await reader.isInsideWorkTree()).toBe(true);
		expect(await reader.headSha()).toBe((await git.revparse(["HEAD"])).trim());
		expect(await reader.symbolicBranch()).toBe((await git.branch()).current);
		expect(await reader.workspacePrefix()).toBe(" leading/");
		expect(await reader.worktreeStatus()).toBe("");
		await writeFile(join(dir, "untracked.txt"), "outside the workspace");
		expect(await reader.worktreeStatus()).toContain("untracked.txt");
	});

	test("forwards normalized cwd and cancellation to raw queries", async () => {
		const git = vi.fn(async () => ({ stdout: " value\n" }));
		const signal = new AbortController().signal;
		const cwd = join("relative", "workspace");
		const reader = createWorkspaceGitReader({ cwd, git, signal });
		await reader.headSha();
		await reader.symbolicBranch();
		await reader.branchRemote("feature");
		await reader.branchMergeRef("feature");
		await reader.remoteUrl("upstream");
		await reader.remoteRefs("upstream", "refs/heads/main");
		await reader.isInsideWorkTree();
		await reader.worktreeStatus();
		expect(await reader.workspacePrefix()).toBe(" value");
		expect(git).toHaveBeenCalledTimes(9);
		for (const call of vi.mocked(git).mock.calls) {
			expect(call).toEqual([expect.any(Array), { cwd: resolve(cwd), signal }]);
		}
	});

	test("preserves command errors rather than hiding broken repositories", async () => {
		const error = Object.assign(new Error("unable to read repository"), {
			code: 128,
			stderr: "fatal: unable to read repository",
		});
		const git = vi.fn().mockRejectedValue(error);
		const reader = createWorkspaceGitReader({ cwd: "/repo", git });
		await expect(reader.isInsideWorkTree()).rejects.toBe(error);
		await expect(reader.headSha()).rejects.toBe(error);
		await expect(reader.symbolicBranch()).rejects.toBe(error);
	});

	test("honors cancellation with the default command runner", async () => {
		const controller = new AbortController();
		controller.abort();
		const reader = createWorkspaceGitReader({
			cwd: await createTempDir(),
			signal: controller.signal,
		});
		await expect(reader.isInsideWorkTree()).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	test("does not treat a bare repository as a working tree", async () => {
		const cwd = await createTempDir();
		await simpleGit({ baseDir: cwd }).init(true);
		await expect(
			createWorkspaceGitReader({ cwd }).isInsideWorkTree(),
		).resolves.toBe(false);
	});
});

describe("readGitWorkspaceState", () => {
	test("prefers origin and returns the current branch", async () => {
		const dir = await createTempDir();
		const git = simpleGit({ baseDir: dir });
		await git.init();
		await git.addConfig("user.email", "test@example.com");
		await git.addConfig("user.name", "Test");
		await git.commit("initial", ["--allow-empty"]);
		await git.addRemote("backup", "https://example.com/backup.git");
		await git.addRemote("origin", "git@github.com:cline/cline.git");

		await expect(readGitWorkspaceState(dir)).resolves.toEqual({
			url: "git@github.com:cline/cline.git",
			branch: (await git.branch()).current,
		});
	});

	test("returns no fields outside a git repository", async () => {
		await expect(readGitWorkspaceState(await createTempDir())).resolves.toEqual(
			{},
		);
	});

	test("falls back to the first remote when origin is absent", async () => {
		const dir = await createTempDir();
		const git = simpleGit({ baseDir: dir });
		await git.init();
		await git.addRemote("backup", "https://example.com/backup.git");
		await expect(readGitWorkspaceState(dir)).resolves.toEqual({
			url: "https://example.com/backup.git",
		});
	});

	test("returns undefined, not empty metadata, when discovery fails", async () => {
		const missing = join(await createTempDir(), "missing");
		await expect(readGitWorkspaceState(missing)).resolves.toBeUndefined();
	});
});

describe("session git metadata", () => {
	test("reads normalized git metadata", () => {
		expect(
			readSessionGitMetadata({
				git: { url: " https://example.com/repo.git ", branch: " main " },
			}),
		).toEqual({
			url: "https://example.com/repo.git",
			branch: "main",
		});
		expect(readSessionGitMetadata({ git: "invalid" })).toEqual({});
	});

	test("merges git state without replacing sibling metadata", () => {
		expect(
			withSessionGitMetadata(
				{
					title: "Session title",
					checkpoint: { latest: { ref: "abc" } },
					git: { url: "old", commit: "preserved" },
				},
				{ url: "new", branch: "feature" },
			),
		).toEqual({
			title: "Session title",
			checkpoint: { latest: { ref: "abc" } },
			git: { url: "new", branch: "feature", commit: "preserved" },
		});
	});

	test("detects current state and removes git for non-git workspaces", () => {
		const metadata = {
			title: "Session title",
			git: { url: "https://example.com/repo.git", branch: "main" },
		};
		expect(
			hasCurrentSessionGitMetadata(metadata, {
				url: "https://example.com/repo.git",
				branch: "main",
			}),
		).toBe(true);
		expect(withSessionGitMetadata(metadata, {})).toEqual({
			title: "Session title",
		});
	});
});

describe("generateWorkspaceInfoWithDiagnostics", () => {
	test("non-git directory reports vcsType none with no error", async () => {
		const dir = await createTempDir();
		const result = await generateWorkspaceInfoWithDiagnostics(dir);
		expect(result.vcsType).toBe("none");
		expect(result.error).toBeUndefined();
	});

	test("freshly initialized repo with no commits is not an init error", async () => {
		const dir = await createTempDir();
		await simpleGit({ baseDir: dir }).init();
		const result = await generateWorkspaceInfoWithDiagnostics(dir);
		expect(result.vcsType).toBe("git");
		// `git rev-parse HEAD` fails on an empty repo — that is a normal
		// repository state, not a workspace init error.
		expect(result.error).toBeUndefined();
		expect(result.info.latestGitCommitHash).toBeUndefined();
		expect(result.info.latestGitBranchName).toBeUndefined();
	});

	test("repo with a commit reports hash and branch with no error", async () => {
		const dir = await createTempDir();
		const git = simpleGit({ baseDir: dir });
		await git.init();
		await git.addConfig("user.email", "test@example.com");
		await git.addConfig("user.name", "Test");
		await git.commit("initial", ["--allow-empty"]);
		const result = await generateWorkspaceInfoWithDiagnostics(dir);
		expect(result.vcsType).toBe("git");
		expect(result.error).toBeUndefined();
		expect(result.info.latestGitCommitHash).toBeTruthy();
		expect(result.info.latestGitBranchName).toBeTruthy();
	});

	test("keeps a detached display branch while strict readers reject it", async () => {
		const dir = await createTempDir();
		const git = simpleGit({ baseDir: dir });
		await git.init();
		await git.addConfig("user.email", "test@example.com");
		await git.addConfig("user.name", "Test");
		await git.commit("initial", ["--allow-empty"]);
		await git.addTag("v1");
		await git.checkout(["--detach", "v1"]);
		const branch = (await git.branch()).current;
		const result = await generateWorkspaceInfoWithDiagnostics(dir);
		expect(result.error).toBeUndefined();
		expect(result.info.latestGitBranchName).toBe(branch);
		await expect(readGitWorkspaceState(dir)).resolves.toEqual({ branch });
		await expect(
			createWorkspaceGitReader({ cwd: dir }).symbolicBranch(),
		).rejects.toMatchObject({ code: 1 });
	});

	test("filesystem root omits the hint and passes manifest validation", async () => {
		// basename of a root path ("/", "C:\\") is "", which WorkspaceInfoSchema
		// rejects — the hint must be omitted, not empty, or upsertWorkspaceInfo
		// throws for every session rooted there.
		const root = parse(tmpdir()).root;
		const { info } = await generateWorkspaceInfoWithDiagnostics(root);
		expect(info.rootPath).toBe(root);
		expect(info.hint).toBeUndefined();
		expect(() =>
			upsertWorkspaceInfo(emptyWorkspaceManifest(), info),
		).not.toThrow();
	});

	test("nonexistent workspace path still reports an error", async () => {
		const result = await generateWorkspaceInfoWithDiagnostics(
			join(tmpdir(), "workspace-manifest-test-does-not-exist"),
		);
		expect(result.vcsType).toBe("none");
		expect(result.error).toBeDefined();
	});
});
