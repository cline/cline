import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import {
	applyCheckpointToWorktree,
	beginWorktreeRestoreTransaction,
} from "./checkpoint-restore";

for (const mode of [
	"direct",
	"transaction",
	"rollback",
	"unchanged",
	"two-parent",
	"literal-pattern",
	"subdirectory",
] as const) {
	it(`preserves pre-restore ignored files: ${mode}`, async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-ignore-regression-"));
		const dir = mode === "subdirectory" ? join(root, "sub") : root;
		mkdirSync(dir, { recursive: true });
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", dir, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		try {
			execFileSync("git", ["-C", root, "init"], { stdio: "ignore" });
			git("config", "user.email", "test@example.invalid");
			git("config", "user.name", "Test");
			git("config", "core.autocrlf", "false");
			writeFileSync(
				join(dir, ".gitignore"),
				mode === "unchanged" ? "scratch/\n" : "",
			);
			writeFileSync(join(dir, "tracked.txt"), "base\n");
			git("add", ".");
			git("commit", "-m", "base");
			writeFileSync(join(dir, "tracked.txt"), "checkpoint\n");
			if (mode !== "two-parent")
				writeFileSync(join(dir, "checkpoint.txt"), "snapshot\n");
			git(
				"stash",
				"push",
				...(mode === "two-parent" ? [] : ["--include-untracked"]),
			);
			const ref = git("rev-parse", "refs/stash");
			git("update-ref", "refs/test/checkpoint", ref);
			git("stash", "drop");
			if (mode !== "two-parent")
				assert.equal(git("cat-file", "-t", `${ref}^3`), "commit");
			const folder = mode === "literal-pattern" ? "scratch [a]! #" : "scratch";
			const rule =
				mode === "literal-pattern" ? "scratch \\[a\\]! #/\n" : "scratch/\n";
			writeFileSync(join(dir, ".gitignore"), rule);
			mkdirSync(join(dir, folder));
			const protectedFile = join(dir, folder, "payload.txt");
			writeFileSync(protectedFile, "irreplaceable bytes\n");
			git("check-ignore", protectedFile);
			writeFileSync(join(dir, "tracked.txt"), "later\n");
			writeFileSync(join(dir, "ordinary.txt"), "later untracked\n");
			const checkpoint = {
				ref,
				kind: "stash" as const,
				createdAt: Date.now(),
				runCount: 1,
			};
			if (
				mode === "transaction" ||
				mode === "rollback" ||
				mode === "subdirectory"
			) {
				const transaction = await beginWorktreeRestoreTransaction(dir);
				if (mode === "rollback") {
					await transaction.rollback();
					assert.equal(
						readFileSync(join(dir, "tracked.txt"), "utf8"),
						"later\n",
					);
					assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), rule);
					assert.equal(
						readFileSync(join(dir, "ordinary.txt"), "utf8"),
						"later untracked\n",
					);
				} else {
					await applyCheckpointToWorktree(
						dir,
						checkpoint,
						transaction.ignoredPaths,
					);
					await transaction.commit();
				}
				assert.equal(
					git(
						"for-each-ref",
						"--format=%(refname)",
						"refs/cline/restore-transactions",
					),
					"",
				);
			} else {
				await applyCheckpointToWorktree(dir, checkpoint);
			}
			assert.equal(
				readFileSync(protectedFile, "utf8"),
				"irreplaceable bytes\n",
			);
			if (mode !== "rollback") {
				assert.equal(
					readFileSync(join(dir, "tracked.txt"), "utf8"),
					"checkpoint\n",
				);
				if (mode !== "two-parent") {
					assert.equal(
						readFileSync(join(dir, "checkpoint.txt"), "utf8"),
						"snapshot\n",
					);
					assert.equal(existsSync(join(dir, "ordinary.txt")), false);
				} else assert.equal(existsSync(join(dir, "ordinary.txt")), true);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

it("refuses an oversized ignored inventory before transaction or direct restore mutates files", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cline-ignore-capacity-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	try {
		git("init");
		git("config", "user.email", "test@example.invalid");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, ".gitignore"), "");
		writeFileSync(join(dir, "tracked.txt"), "base");
		git("add", ".");
		git("commit", "-m", "base");
		const originalHead = git("rev-parse", "HEAD");
		writeFileSync(join(dir, "snapshot.txt"), "snapshot");
		git("stash", "push", "--include-untracked");
		const ref = git("rev-parse", "refs/stash");
		git("update-ref", "refs/test/checkpoint", ref);
		git("stash", "drop");
		writeFileSync(join(dir, ".gitignore"), "*.log\n");
		writeFileSync(join(dir, "tracked.txt"), "staged");
		git("add", "tracked.txt");
		writeFileSync(join(dir, "tracked.txt"), "unstaged");
		for (let n = 0; n < 500; n++)
			writeFileSync(
				join(dir, `ignored-long-filename-${n.toString().padStart(4, "0")}.log`),
				"keep",
			);
		const status = git("status", "--porcelain");
		await assert.rejects(
			beginWorktreeRestoreTransaction(dir),
			/too many ignored paths/,
		);
		await assert.rejects(
			applyCheckpointToWorktree(dir, {
				ref,
				kind: "stash",
				createdAt: 1,
				runCount: 1,
			}),
			/too many ignored paths/,
		);
		assert.equal(git("status", "--porcelain"), status);
		assert.equal(git("show", ":tracked.txt"), "staged");
		assert.equal(readFileSync(join(dir, "tracked.txt"), "utf8"), "unstaged");
		assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*.log\n");
		assert.equal(git("rev-parse", "HEAD"), originalHead);
		assert.equal(git("stash", "list"), "");
		for (let n = 0; n < 500; n++)
			assert.equal(
				readFileSync(
					join(
						dir,
						`ignored-long-filename-${n.toString().padStart(4, "0")}.log`,
					),
					"utf8",
				),
				"keep",
			);
		// A direct commit restore never cleans untracked files and needs no argv inventory.
		await applyCheckpointToWorktree(dir, {
			ref: originalHead,
			kind: "commit",
			createdAt: 1,
			runCount: 1,
		});
		assert.equal(readFileSync(join(dir, "tracked.txt"), "utf8"), "base");
		for (let n = 0; n < 500; n++)
			assert.equal(
				readFileSync(
					join(
						dir,
						`ignored-long-filename-${n.toString().padStart(4, "0")}.log`,
					),
					"utf8",
				),
				"keep",
			);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
