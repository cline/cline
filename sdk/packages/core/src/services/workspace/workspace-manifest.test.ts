import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, describe, expect, test } from "vitest";
import {
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

	test("nonexistent workspace path still reports an error", async () => {
		const result = await generateWorkspaceInfoWithDiagnostics(
			join(tmpdir(), "workspace-manifest-test-does-not-exist"),
		);
		expect(result.vcsType).toBe("none");
		expect(result.error).toBeDefined();
	});
});
