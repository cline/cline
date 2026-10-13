import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFactoryDiff } from "./factory-review";

const execFileAsync = promisify(execFile);
let cwd: string;
let baseCommit: string;
async function git(...args: string[]) {
	const { stdout } = await execFileAsync(
		"git",
		[
			"-c",
			"user.name=Factory Test",
			"-c",
			"user.email=factory@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{ cwd, encoding: "utf8" },
	);
	return stdout.trim();
}
async function commit() {
	await git("add", ".");
	await git("commit", "-m", "Synthetic fixture");
	return git("rev-parse", "HEAD");
}
function reply(candidateCommit?: string) {
	return {
		runs: [
			{
				runId: "run-1",
				factory: { workspace: { path: cwd, baseCommit }, candidateCommit },
			},
		],
	};
}
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "factory-review-test-"));
	await git("init");
	await writeFile(join(cwd, "file.txt"), "before\n");
	baseCommit = await commit();
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("Factory committed review diff", () => {
	it("shows exactly the recorded candidate, preserving whitespace and ignoring later commits and worktree edits", async () => {
		await writeFile(join(cwd, "file.txt"), "after  \n");
		const candidate = await commit();
		await writeFile(join(cwd, "file.txt"), "later commit\n");
		await commit();
		await writeFile(join(cwd, "file.txt"), "uncommitted edit\n");
		expect(await readFactoryDiff(reply(candidate), "run-1")).toEqual([
			{
				path: "file.txt",
				additions: 1,
				deletions: 1,
				hunks: [
					{ oldStart: 1, newStart: 1, old: "before\n", new: "after  \n" },
				],
			},
		]);
	});

	it("includes added, deleted and binary files", async () => {
		await rm(join(cwd, "file.txt"));
		await writeFile(join(cwd, "added file.txt"), "first\nsecond\n");
		await writeFile(join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3]));
		const candidate = await commit();
		const files = await readFactoryDiff(reply(candidate), "run-1");
		expect(
			files.map(({ path, additions, deletions }) => ({
				path,
				additions,
				deletions,
			})),
		).toEqual([
			{ path: "added file.txt", additions: 2, deletions: 0 },
			{ path: "file.txt", additions: 0, deletions: 1 },
			{ path: "image.bin", additions: 0, deletions: 0 },
		]);
		expect(files[0].hunks[0].new).toBe("first\nsecond\n");
	});

	it("requires a recorded candidate on the requested run", async () => {
		await expect(readFactoryDiff(reply(), "run-1")).rejects.toThrow(
			"no recorded candidate",
		);
		await expect(
			readFactoryDiff(reply(baseCommit), "other-run"),
		).rejects.toThrow("no recorded candidate");
	});

	it("rejects mutable refs and absent commit objects", async () => {
		await expect(readFactoryDiff(reply("HEAD"), "run-1")).rejects.toThrow();
		await expect(
			readFactoryDiff(reply("f".repeat(40)), "run-1"),
		).rejects.toThrow();
	});
});
