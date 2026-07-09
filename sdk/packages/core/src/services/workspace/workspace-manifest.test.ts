import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, describe, expect, test } from "vitest";
import { generateWorkspaceInfoWithDiagnostics } from "./workspace-manifest";

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
