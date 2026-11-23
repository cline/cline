import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveClineDir } from "./paths";
import {
	isWorkspaceTrusted,
	resolveTrustedWorkspacesPath,
	trustWorkspace,
} from "./workspace-trust";

describe("workspace trust", () => {
	const originalDataDir = process.env.CLINE_DATA_DIR;
	let dataDir = "";

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "workspace-trust-"));
		process.env.CLINE_DATA_DIR = dataDir;
	});

	afterEach(() => {
		if (originalDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalDataDir;
		}
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("trusts a folder and everything inside it once allowed", () => {
		const repo = join(tmpdir(), "repo");
		expect(isWorkspaceTrusted(repo)).toBe(false);

		trustWorkspace(repo);

		expect(isWorkspaceTrusted(repo)).toBe(true);
		expect(isWorkspaceTrusted(join(repo, "packages", "app"))).toBe(true);
		expect(isWorkspaceTrusted(`${repo}-other`)).toBe(false);
		expect(isWorkspaceTrusted(tmpdir())).toBe(false);
	});

	it("persists each folder once", () => {
		const repo = join(tmpdir(), "repo");
		trustWorkspace(repo);
		trustWorkspace(repo);
		trustWorkspace(join(repo, "nested"));

		expect(
			JSON.parse(readFileSync(resolveTrustedWorkspacesPath(), "utf8")),
		).toEqual({ trustedWorkspaces: [repo] });
	});

	it("never prompts for Cline's own directories", () => {
		expect(isWorkspaceTrusted(join(dataDir, "workspaces", "chat"))).toBe(true);
		expect(
			isWorkspaceTrusted(join(resolveClineDir(), "worktrees", "repo", "abc")),
		).toBe(true);
	});
});
