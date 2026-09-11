import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildCheckpointWorkspaceDiff,
	compareCheckpointToWorkspace,
	createCheckpointComparePlan,
} from "./checkpoint-diff";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

describe("checkpoint workspace comparison", () => {
	let dir = "";
	let checkpointRef = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "core-checkpoint-diff-"));
		mkdirSync(dir, { recursive: true });
		git(dir, ["init"]);
		git(dir, ["config", "user.name", "Cline Test"]);
		git(dir, ["config", "user.email", "cline@example.com"]);
		writeFileSync(join(dir, "tracked.txt"), "base\n", "utf8");
		writeFileSync(join(dir, "deleted.txt"), "delete me\n", "utf8");
		git(dir, ["add", "."]);
		git(dir, ["commit", "-m", "initial"]);
		checkpointRef = git(dir, ["rev-parse", "HEAD"]);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("builds content diffs from a checkpoint ref to the current worktree", async () => {
		writeFileSync(join(dir, "tracked.txt"), "changed\n", "utf8");
		rmSync(join(dir, "deleted.txt"));
		writeFileSync(join(dir, "untracked.txt"), "new file\n", "utf8");

		const diffs = await buildCheckpointWorkspaceDiff(dir, {
			ref: checkpointRef,
			createdAt: Date.now(),
			runCount: 1,
			kind: "commit",
		});

		expect(diffs.map((diff) => diff.filePath.replaceAll("\\", "/"))).toEqual([
			join(dir, "deleted.txt").replaceAll("\\", "/"),
			join(dir, "tracked.txt").replaceAll("\\", "/"),
			join(dir, "untracked.txt").replaceAll("\\", "/"),
		]);
		expect(
			diffs.find((diff) => diff.filePath.endsWith("tracked.txt")),
		).toMatchObject({
			leftContent: "base\n",
			rightContent: "changed\n",
		});
		expect(
			diffs.find((diff) => diff.filePath.endsWith("deleted.txt")),
		).toMatchObject({
			leftContent: "delete me\n",
			rightContent: "",
		});
		expect(
			diffs.find((diff) => diff.filePath.endsWith("untracked.txt")),
		).toMatchObject({
			leftContent: "",
			rightContent: "new file\n",
		});
	});

	it("uses the worktree snapshot stored in SDK stash checkpoints", async () => {
		writeFileSync(join(dir, "tracked.txt"), "checkpoint dirty\n", "utf8");
		const stashRef = git(dir, ["stash", "create", "cline checkpoint test"]);
		writeFileSync(join(dir, "tracked.txt"), "current dirty\n", "utf8");

		const diffs = await buildCheckpointWorkspaceDiff(dir, {
			ref: stashRef,
			createdAt: Date.now(),
			runCount: 1,
			kind: "stash",
		});

		expect(diffs).toHaveLength(1);
		expect(diffs[0]).toMatchObject({
			filePath: join(dir, "tracked.txt"),
			leftContent: "checkpoint dirty\n",
			rightContent: "current dirty\n",
		});
	});

	it("reads untracked-at-snapshot files from the stash third parent", async () => {
		// Replicate createWorktreeStashCommit: capture untracked files in a
		// third-parent commit alongside a plain `git stash create`.
		writeFileSync(join(dir, "pre-existing.txt"), "untouched\n", "utf8");
		writeFileSync(join(dir, "edited-later.txt"), "original\n", "utf8");
		writeFileSync(join(dir, "deleted-later.txt"), "will be deleted\n", "utf8");
		writeFileSync(join(dir, "tracked.txt"), "checkpoint dirty\n", "utf8");

		const indexFile = join(dir, ".git", "checkpoint-test-index");
		const gitWithIndex = (args: string[]) =>
			execFileSync("git", ["-C", dir, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, GIT_INDEX_FILE: indexFile },
			}).trim();
		gitWithIndex([
			"add",
			"--force",
			"pre-existing.txt",
			"edited-later.txt",
			"deleted-later.txt",
		]);
		const untrackedTree = gitWithIndex(["write-tree"]);
		const untrackedParent = git(dir, [
			"commit-tree",
			untrackedTree,
			"-m",
			"untracked files on cline checkpoint",
		]);
		const stashRef = git(dir, ["stash", "create", "cline checkpoint test"]);
		const snapshotRef = git(dir, [
			"commit-tree",
			`${stashRef}^{tree}`,
			"-p",
			git(dir, ["rev-parse", `${stashRef}^1`]),
			"-p",
			git(dir, ["rev-parse", `${stashRef}^2`]),
			"-p",
			untrackedParent,
			"-m",
			"cline checkpoint test",
		]);

		writeFileSync(join(dir, "edited-later.txt"), "changed\n", "utf8");
		rmSync(join(dir, "deleted-later.txt"));

		const diffs = await buildCheckpointWorkspaceDiff(dir, {
			ref: snapshotRef,
			createdAt: Date.now(),
			runCount: 1,
			kind: "stash",
		});

		const paths = diffs.map((diff) => diff.filePath);
		// Unchanged pre-existing untracked file must not appear as "added".
		expect(paths).not.toContain(join(dir, "pre-existing.txt"));
		expect(
			diffs.find((diff) => diff.filePath.endsWith("edited-later.txt")),
		).toMatchObject({
			leftContent: "original\n",
			rightContent: "changed\n",
		});
		// A file untracked at snapshot time and deleted since shows as deleted.
		expect(
			diffs.find((diff) => diff.filePath.endsWith("deleted-later.txt")),
		).toMatchObject({
			leftContent: "will be deleted\n",
			rightContent: "",
		});
	});

	it("selects the nearest checkpoint at or before the requested run", async () => {
		const session = {
			sessionId: "session-1",
			source: "cli",
			status: "running",
			startedAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			interactive: true,
			provider: "mock",
			model: "mock",
			cwd: dir,
			workspaceRoot: dir,
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			isSubagent: false,
			metadata: {
				checkpoint: {
					latest: { ref: "bbbb", createdAt: 2, runCount: 3 },
					history: [
						{ ref: "aaaa", createdAt: 1, runCount: 1 },
						{ ref: "bbbb", createdAt: 2, runCount: 3 },
					],
				},
			},
		} as const;

		const plan = createCheckpointComparePlan({
			session,
			checkpointRunCount: 2,
		});

		expect(plan.checkpoint).toMatchObject({ ref: "aaaa", runCount: 1 });
		expect(plan.cwd).toBe(dir);
	});

	it("returns the compare plan and workspace diffs together", async () => {
		writeFileSync(join(dir, "tracked.txt"), "changed\n", "utf8");
		const session = {
			sessionId: "session-1",
			source: "cli",
			status: "running",
			startedAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			interactive: true,
			provider: "mock",
			model: "mock",
			cwd: dir,
			workspaceRoot: dir,
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			isSubagent: false,
			metadata: {
				checkpoint: {
					latest: { ref: checkpointRef, createdAt: 1, runCount: 1 },
					history: [{ ref: checkpointRef, createdAt: 1, runCount: 1 }],
				},
			},
		} as const;

		const result = await compareCheckpointToWorkspace({
			session,
			checkpointRunCount: 1,
		});

		expect(result.checkpoint.ref).toBe(checkpointRef);
		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]).toMatchObject({
			filePath: join(dir, "tracked.txt"),
			leftContent: "base\n",
			rightContent: "changed\n",
		});
	});
});
