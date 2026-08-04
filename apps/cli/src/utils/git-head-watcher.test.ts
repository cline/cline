import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGitDir, watchGitHead } from "./git-head-watcher";
import { isSameRepoStatus, readRepoStatus } from "./repo-status";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
	await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

async function createRepo(dir: string): Promise<void> {
	await git(dir, "init", "--initial-branch=main");
	await git(dir, "config", "user.email", "test@example.com");
	await git(dir, "config", "user.name", "Test");
	await git(dir, "config", "commit.gpgsign", "false");
	await writeFile(join(dir, "file.txt"), "hello\n");
	await git(dir, "add", ".");
	await git(dir, "commit", "-m", "init");
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() - started > timeoutMs) {
				reject(new Error("timed out waiting for condition"));
				return;
			}
			setTimeout(tick, 25);
		};
		tick();
	});
}

describe("git head watcher", () => {
	let dir: string;
	let dispose: (() => void) | null = null;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "cline-head-watch-"));
	});

	afterEach(async () => {
		dispose?.();
		dispose = null;
		await rm(dir, { recursive: true, force: true });
	});

	it("resolves the git dir of a repository", async () => {
		await createRepo(dir);
		const gitDir = await resolveGitDir(dir);
		expect(gitDir).toBeTruthy();
		expect(gitDir?.endsWith(".git")).toBe(true);
	});

	it("returns null for a non-repository directory", async () => {
		expect(await resolveGitDir(dir)).toBeNull();
	});

	it("fires when the branch changes externally", async () => {
		await createRepo(dir);
		let changes = 0;
		dispose = watchGitHead(dir, () => {
			changes += 1;
		});
		// The watcher resolves the git dir asynchronously; give it time to arm.
		await new Promise((resolve) => setTimeout(resolve, 300));

		await git(dir, "checkout", "-b", "feature-branch");
		await waitFor(() => changes > 0);

		const status = await readRepoStatus(dir);
		expect(status.branch).toBe("feature-branch");
	});

	it("stops firing after dispose", async () => {
		await createRepo(dir);
		let changes = 0;
		const stop = watchGitHead(dir, () => {
			changes += 1;
		});
		await new Promise((resolve) => setTimeout(resolve, 300));
		stop();

		await git(dir, "checkout", "-b", "another-branch");
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(changes).toBe(0);
	});

	it("is a no-op for a non-repository directory", async () => {
		dispose = watchGitHead(dir, () => {
			throw new Error("should not fire");
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
});

describe("isSameRepoStatus", () => {
	it("treats identical statuses as equal", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
			),
		).toBe(true);
		expect(
			isSameRepoStatus(
				{ branch: null, diffStats: null },
				{ branch: null, diffStats: null },
			),
		).toBe(true);
	});

	it("detects branch and diff changes", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "feature", diffStats: null },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "main", diffStats: { files: 1, additions: 0, deletions: 0 } },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 4 } },
			),
		).toBe(false);
	});
});
