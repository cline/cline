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
import type { CheckpointEntry } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	listWorkspaceDirectory,
	readWorkspaceChanges,
	readWorkspaceFile,
	revertWorkspaceChange,
} from "./workspace-changes";

let sandbox: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
	// Fixtures must not inherit a developer's signing or fsmonitor setup;
	// either can stall commits for seconds and trip the hook timeout.
	return execFileSync(
		"git",
		[
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.fsmonitor=false",
			...args,
		],
		{ cwd, encoding: "utf8" },
	).trim();
}

function checkpoint(runCount: number): CheckpointEntry {
	return {
		ref: git(repo, "rev-parse", "HEAD"),
		createdAt: runCount,
		runCount,
		kind: "commit",
	};
}

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "cline-changes-"));
	repo = join(sandbox, "repo");
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src", "a.ts"), "const a = 1;\n");
	writeFileSync(join(repo, "README.md"), "# readme\n");
	git(sandbox, "init", "-q", "-b", "main", repo);
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "init");
});

afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true });
});

describe("readWorkspaceChanges", () => {
	it("reports the workspace as unavailable outside a git repository", async () => {
		const plain = join(sandbox, "plain");
		mkdirSync(plain);
		const result = await readWorkspaceChanges({ cwd: plain, scope: "session" });
		expect(result.files).toEqual([]);
		expect(result.unavailableReason).toMatch(/not a git repository/);
	});

	it("diffs the working tree against HEAD for the uncommitted scope", async () => {
		writeFileSync(join(repo, "src", "a.ts"), "const a = 2;\n");
		writeFileSync(join(repo, "src", "new.ts"), "export {};\n");
		rmSync(join(repo, "README.md"));

		const result = await readWorkspaceChanges({
			cwd: repo,
			scope: "uncommitted",
		});

		expect(result.unavailableReason).toBeUndefined();
		expect(result.base?.label).toBe("HEAD");
		expect(
			result.files.map(({ path, status, oldText, newText }) => ({
				path,
				status,
				oldText,
				newText,
			})),
		).toEqual([
			{
				path: "README.md",
				status: "deleted",
				oldText: "# readme\n",
				newText: "",
			},
			{
				path: "src/a.ts",
				status: "modified",
				oldText: "const a = 1;\n",
				newText: "const a = 2;\n",
			},
			{
				path: "src/new.ts",
				status: "added",
				oldText: "",
				newText: "export {};\n",
			},
		]);
	});

	it("uses the earliest checkpoint for session scope and the latest for turn scope", async () => {
		const first = checkpoint(1);
		writeFileSync(join(repo, "src", "a.ts"), "const a = 2;\n");
		git(repo, "commit", "-q", "-am", "turn 1");
		const second = checkpoint(2);
		writeFileSync(join(repo, "src", "b.ts"), "const b = 1;\n");
		const checkpoints = [first, second];

		const session = await readWorkspaceChanges({
			cwd: repo,
			scope: "session",
			checkpoints,
		});
		expect(session.base).toEqual({ label: "start of session", runCount: 1 });
		expect(session.files.map((file) => `${file.status}:${file.path}`)).toEqual([
			"modified:src/a.ts",
			"added:src/b.ts",
		]);

		const turn = await readWorkspaceChanges({
			cwd: repo,
			scope: "turn",
			checkpoints,
		});
		expect(turn.base).toEqual({ label: "start of last turn", runCount: 2 });
		expect(turn.files.map((file) => `${file.status}:${file.path}`)).toEqual([
			"added:src/b.ts",
		]);
	});

	it("anchors paths on the repository root when the workspace is a subfolder", async () => {
		writeFileSync(join(repo, "src", "a.ts"), "const a = 2;\n");
		const result = await readWorkspaceChanges({
			cwd: join(repo, "src"),
			scope: "uncommitted",
		});
		expect(result.root).toBe(git(repo, "rev-parse", "--show-toplevel"));
		expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
		await revertWorkspaceChange({
			cwd: join(repo, "src"),
			scope: "uncommitted",
			path: "src/a.ts",
		});
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe(
			"const a = 1;\n",
		);
	});

	it("explains a missing checkpoint instead of failing", async () => {
		const result = await readWorkspaceChanges({
			cwd: repo,
			scope: "turn",
			checkpoints: [],
		});
		expect(result.files).toEqual([]);
		expect(result.unavailableReason).toMatch(/No checkpoint/);
	});

	it("omits binary contents but keeps the file listed", async () => {
		writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 3]));
		const result = await readWorkspaceChanges({
			cwd: repo,
			scope: "uncommitted",
		});
		expect(result.files).toEqual([
			{
				path: "blob.bin",
				status: "added",
				oldText: "",
				newText: "",
				binary: true,
			},
		]);
	});
});

describe("revertWorkspaceChange", () => {
	it("restores a modified file and deletes one that did not exist at the base", async () => {
		const base = checkpoint(1);
		writeFileSync(join(repo, "src", "a.ts"), "const a = 2;\n");
		writeFileSync(join(repo, "src", "new.ts"), "export {};\n");

		await expect(
			revertWorkspaceChange({
				cwd: repo,
				scope: "session",
				path: "src/a.ts",
				checkpoints: [base],
			}),
		).resolves.toEqual({ path: "src/a.ts", action: "restored" });
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe(
			"const a = 1;\n",
		);

		await expect(
			revertWorkspaceChange({
				cwd: repo,
				scope: "uncommitted",
				path: "src/new.ts",
			}),
		).resolves.toEqual({ path: "src/new.ts", action: "deleted" });
		expect(existsSync(join(repo, "src", "new.ts"))).toBe(false);
	});

	it("recreates a deleted file from HEAD", async () => {
		rmSync(join(repo, "README.md"));
		await revertWorkspaceChange({
			cwd: repo,
			scope: "uncommitted",
			path: "README.md",
		});
		expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# readme\n");
	});

	it("refuses paths outside the workspace", async () => {
		await expect(
			revertWorkspaceChange({
				cwd: repo,
				scope: "uncommitted",
				path: "../outside.txt",
			}),
		).rejects.toThrow(/escapes workspace/);
	});
});

describe("workspace browsing", () => {
	it("lists one directory level with folders first and .git hidden", async () => {
		const root = await listWorkspaceDirectory(repo);
		expect(root.path).toBe("");
		expect(root.entries).toEqual([
			{ name: "src", path: "src", kind: "directory" },
			{ name: "README.md", path: "README.md", kind: "file" },
		]);
		const src = await listWorkspaceDirectory(repo, "src");
		expect(src.entries).toEqual([
			{ name: "a.ts", path: "src/a.ts", kind: "file" },
		]);
	});

	it("reads text files and flags binary ones", async () => {
		await expect(readWorkspaceFile(repo, "src/a.ts")).resolves.toEqual({
			path: "src/a.ts",
			text: "const a = 1;\n",
			size: 13,
		});
		writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2]));
		await expect(readWorkspaceFile(repo, "blob.bin")).resolves.toMatchObject({
			binary: true,
			text: "",
		});
		await expect(readWorkspaceFile(repo, "src")).rejects.toThrow(/Not a file/);
	});
});
