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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyCheckpointToWorktree,
	createCheckpointRestorePlan,
	createRestoredCheckpointMetadata,
	trimMessagesBeforeCheckpoint,
	trimMessagesToCheckpoint,
} from "./checkpoint-restore";

const fsMocks = vi.hoisted(() => ({
	chmod: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
	const actual =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	fsMocks.chmod.mockImplementation(actual.chmod);
	return { ...actual, chmod: fsMocks.chmod };
});

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
	let outsideDir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "checkpoint-restore-"));
		outsideDir = mkdtempSync(join(tmpdir(), "checkpoint-restore-outside-"));
		mkdirSync(dir, { recursive: true });
		createRepo(dir);
	});

	afterEach(() => {
		fsMocks.chmod.mockClear();
		rmSync(dir, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	});

	it("validates the checkpoint ref before resetting or cleaning the worktree", async () => {
		writeFileSync(join(dir, "tracked.txt"), "dirty\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "keep me\n", "utf8");

		await expect(
			applyCheckpointToWorktree(
				dir,
				{
					ref: "0000000000000000000000000000000000000000",
					createdAt: Date.now(),
					runCount: 1,
					kind: "stash",
				},
				{ approved: true },
			),
		).rejects.toThrow();

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("dirty\n");
		expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me\n");
	});

	it("blocks dirty workspace restore until explicitly approved and then restores only checkpoint paths", async () => {
		const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
		writeFileSync(join(dir, "tracked.txt"), "dirty\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "remove me\n", "utf8");

		await expect(
			applyCheckpointToWorktree(dir, {
				ref: checkpointRef,
				createdAt: Date.now(),
				runCount: 1,
				kind: "commit",
			}),
		).rejects.toMatchObject({ code: "approval_required" });
		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("dirty\n");

		const result = await applyCheckpointToWorktree(
			dir,
			{
				ref: checkpointRef,
				createdAt: Date.now(),
				runCount: 1,
				kind: "commit",
			},
			{ approved: true },
		);

		expect(result.status).toBe("restored");
		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("base\n");
		expect(() => readFileSync(join(dir, "untracked.txt"), "utf8")).toThrow();
	});

	it("reports a partial failure and rolls back files already written", async () => {
		writeFileSync(join(dir, "a-first.txt"), "checkpoint\n", "utf8");
		writeFileSync(join(dir, "z-link"), "target.txt", "utf8");
		git(dir, ["add", "a-first.txt", "z-link"]);
		const linkBlob = git(dir, ["hash-object", "-w", "z-link"]);
		git(dir, ["update-index", "--cacheinfo", `120000,${linkBlob},z-link`]);
		git(dir, ["commit", "-m", "checkpoint with symlink"]);
		const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
		writeFileSync(join(dir, "a-first.txt"), "current\n", "utf8");
		writeFileSync(join(dir, "z-link"), "changed target\n", "utf8");

		await expect(
			applyCheckpointToWorktree(
				dir,
				{
					ref: checkpointRef,
					createdAt: Date.now(),
					runCount: 1,
					kind: "commit",
				},
				{ approved: true },
			),
		).rejects.toMatchObject({
			code: "partial_failure",
			result: {
				status: "partial",
				files: [
					expect.objectContaining({
						filePath: join(dir, "a-first.txt"),
						status: "rolled-back",
					}),
				],
			},
		});
		expect(readFileSync(join(dir, "a-first.txt"), "utf8")).toBe("current\n");
	});

	it("rejects a checkpoint path whose parent is a symlink", async () => {
		const nestedDir = join(dir, "nested");
		mkdirSync(nestedDir);
		writeFileSync(join(nestedDir, "target.txt"), "checkpoint\n", "utf8");
		git(dir, ["add", "nested/target.txt"]);
		git(dir, ["commit", "-m", "checkpoint with nested file"]);
		const checkpointRef = git(dir, ["rev-parse", "HEAD"]);

		rmSync(nestedDir, { recursive: true, force: true });
		writeFileSync(join(outsideDir, "target.txt"), "outside\n", "utf8");
		symlinkSync(
			outsideDir,
			nestedDir,
			process.platform === "win32" ? "junction" : "dir",
		);

		await expect(
			applyCheckpointToWorktree(
				dir,
				{
					ref: checkpointRef,
					createdAt: Date.now(),
					runCount: 1,
					kind: "commit",
				},
				{ approved: true },
			),
		).rejects.toThrow(/parent is a symlink/);
		expect(readFileSync(join(outsideDir, "target.txt"), "utf8")).toBe(
			"outside\n",
		);
	});

	it.skipIf(process.platform === "win32")(
		"rolls back the current file when chmod fails after writing",
		async () => {
			writeFileSync(join(dir, "executable.sh"), "checkpoint\n", "utf8");
			git(dir, ["add", "executable.sh"]);
			git(dir, ["update-index", "--chmod=+x", "executable.sh"]);
			git(dir, ["commit", "-m", "checkpoint with executable"]);
			const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
			writeFileSync(join(dir, "executable.sh"), "current\n", "utf8");
			fsMocks.chmod.mockRejectedValueOnce(new Error("chmod failed"));

			await expect(
				applyCheckpointToWorktree(
					dir,
					{
						ref: checkpointRef,
						createdAt: Date.now(),
						runCount: 1,
						kind: "commit",
					},
					{ approved: true },
				),
			).rejects.toMatchObject({
				code: "partial_failure",
				result: {
					files: [
						expect.objectContaining({
							filePath: join(dir, "executable.sh"),
							status: "rolled-back",
						}),
					],
				},
			});
			expect(readFileSync(join(dir, "executable.sh"), "utf8")).toBe(
				"current\n",
			);
		},
	);

	it("carries checkpoint metadata through the restored run", () => {
		const metadata = createRestoredCheckpointMetadata(
			{
				metadata: {
					checkpoint: {
						latest: { ref: "cccc", createdAt: 3, runCount: 3 },
						history: [
							{ ref: "aaaa", createdAt: 1, runCount: 1 },
							{ ref: "bbbb", createdAt: 2, runCount: 2 },
							{ ref: "cccc", createdAt: 3, runCount: 3 },
						],
					},
				},
			},
			2,
		);

		expect(metadata?.latest.runCount).toBe(2);
		expect(metadata?.history.map((entry) => entry.runCount)).toEqual([1, 2]);
	});
});

describe("checkpoint message trimming", () => {
	it("can trim either through or before the checkpoint user message", () => {
		const messages = [
			{ role: "user" as const, content: "first" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "second" },
			{ role: "assistant" as const, content: "second response" },
		];

		expect(trimMessagesToCheckpoint(messages, 2)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
			{ role: "user", content: "second" },
		]);
		expect(trimMessagesBeforeCheckpoint(messages, 2)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
		]);
	});

	it("uses the nearest earlier checkpoint when an identical snapshot was deduplicated", () => {
		const messages = [
			{ role: "user" as const, content: "first" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "second" },
			{ role: "assistant" as const, content: "second response" },
			{ role: "user" as const, content: "third" },
		];

		const plan = createCheckpointRestorePlan({
			session: {
				sessionId: "session-1",
				source: "cli",
				status: "running",
				startedAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				interactive: true,
				provider: "mock",
				model: "mock",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				isSubagent: false,
				metadata: {
					checkpoint: {
						latest: { ref: "cccc", createdAt: 3, runCount: 3 },
						history: [
							{ ref: "aaaa", createdAt: 1, runCount: 1 },
							{ ref: "cccc", createdAt: 3, runCount: 3 },
						],
					},
				},
			},
			messages,
			checkpointRunCount: 2,
		});

		expect(plan.checkpoint).toMatchObject({ ref: "aaaa", runCount: 1 });
		expect(plan.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
			{ role: "user", content: "second" },
		]);
	});
});
