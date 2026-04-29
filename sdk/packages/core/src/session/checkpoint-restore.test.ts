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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCheckpointToWorktree } from "./checkpoint-restore";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function createRepo(cwd: string): void {
	git(cwd, ["init"]);
	git(cwd, ["config", "user.name", "Codex Test"]);
	git(cwd, ["config", "user.email", "codex@example.com"]);
	writeFileSync(join(cwd, "tracked.txt"), "base\n", "utf8");
	git(cwd, ["add", "tracked.txt"]);
	git(cwd, ["commit", "-m", "initial"]);
}

describe("applyCheckpointToWorktree", () => {
	let dir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "checkpoint-restore-"));
		mkdirSync(dir, { recursive: true });
		createRepo(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("validates the checkpoint ref before resetting or cleaning the worktree", async () => {
		writeFileSync(join(dir, "tracked.txt"), "dirty\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "keep me\n", "utf8");

		await expect(
			applyCheckpointToWorktree(dir, {
				ref: "0000000000000000000000000000000000000000",
				createdAt: Date.now(),
				runCount: 1,
				kind: "stash",
			}),
		).rejects.toThrow();

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("dirty\n");
		expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me\n");
	});
});
