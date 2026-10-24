import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSameRepoStatus, readRepoStatus } from "./repo-status";

describe("readRepoStatus", () => {
	const repositories: string[] = [];

	afterEach(() => {
		for (const repository of repositories.splice(0)) {
			rmSync(repository, { recursive: true, force: true });
		}
	});

	function repositoryWithCommit(): string {
		const directory = mkdtempSync(join(tmpdir(), "cline-repo-status-"));
		repositories.push(directory);
		execFileSync("git", ["init", "-b", "main", directory]);
		writeFileSync(join(directory, "tracked.txt"), "original\n");
		execFileSync("git", ["-C", directory, "add", "tracked.txt"]);
		execFileSync("git", [
			"-C",
			directory,
			"-c",
			"user.name=Test User",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"-m",
			"initial",
		]);
		return directory;
	}

	it("keeps staged modifications visible in repository diff stats", async () => {
		const directory = repositoryWithCommit();
		writeFileSync(join(directory, "tracked.txt"), "updated\n");
		execFileSync("git", ["-C", directory, "add", "tracked.txt"]);

		expect(await readRepoStatus(directory)).toEqual({
			branch: "main",
			diffStats: { files: 1, additions: 1, deletions: 1 },
		});
	});

	it("includes staged new files and unstaged edits together", async () => {
		const directory = repositoryWithCommit();
		writeFileSync(join(directory, "staged.txt"), "new file\n");
		execFileSync("git", ["-C", directory, "add", "staged.txt"]);
		writeFileSync(join(directory, "tracked.txt"), "updated\n");

		expect((await readRepoStatus(directory)).diffStats).toEqual({
			files: 2,
			additions: 2,
			deletions: 1,
		});
	});

	it("still reports an unstaged change and a clean working tree", async () => {
		const directory = repositoryWithCommit();
		expect(await readRepoStatus(directory)).toEqual({
			branch: "main",
			diffStats: null,
		});
		writeFileSync(join(directory, "tracked.txt"), "updated\n");
		expect((await readRepoStatus(directory)).diffStats).toEqual({
			files: 1,
			additions: 1,
			deletions: 1,
		});
	});

	it("does not double count a staged edit reverted in the working tree", async () => {
		const directory = repositoryWithCommit();
		writeFileSync(join(directory, "tracked.txt"), "updated\n");
		execFileSync("git", ["-C", directory, "add", "tracked.txt"]);
		writeFileSync(join(directory, "tracked.txt"), "original\n");

		expect((await readRepoStatus(directory)).diffStats).toBeNull();
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
