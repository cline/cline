import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { workspacePathsOverlap } from "./session-config";

it("resolves local aliases without combining distinct workspaces", () => {
	const directory = mkdtempSync(join(tmpdir(), "workspace-paths-"));
	const root = join(directory, "repo");
	const child = join(root, "child");
	const alias = join(directory, "alias");
	const other = join(directory, "other-worktree");
	try {
		mkdirSync(child, { recursive: true });
		mkdirSync(other);
		symlinkSync(root, alias, "junction");
		expect(workspacePathsOverlap(alias, root)).toBe(true);
		expect(workspacePathsOverlap(alias, child)).toBe(true);
		expect(workspacePathsOverlap(child, alias)).toBe(true);
		expect(workspacePathsOverlap(alias, other)).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
