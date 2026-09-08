import { describe, expect, it, vi } from "vitest";
import {
	CloudHandoffGitPreflightError,
	type GitCommand,
	normalizeGitHubRemoteUrl,
	preflightCloudHandoffGit,
} from "./git-preflight";

const HEAD = "a".repeat(40);

function fakeGit(overrides: Record<string, string | Error> = {}): GitCommand {
	const outputs: Record<string, string | Error> = {
		"rev-parse --is-inside-work-tree": "true\n",
		"rev-parse --show-prefix": "",
		"status --porcelain=v1 --untracked-files=all --ignore-submodules=none": "",
		"symbolic-ref --quiet --short HEAD": "feature/handoff\n",
		"config --get branch.feature/handoff.remote": "origin\n",
		"config --get branch.feature/handoff.merge": "refs/heads/feature/handoff\n",
		"rev-parse HEAD": `${HEAD}\n`,
		"remote get-url origin": "git@github.com:cline/cline.git\n",
		"ls-remote --exit-code origin refs/heads/feature/handoff": `${HEAD}\trefs/heads/feature/handoff\n`,
		...overrides,
	};
	return vi.fn(async (args) => {
		const result = outputs[args.join(" ")];
		if (result instanceof Error) throw result;
		if (result === undefined) throw new Error(`Unexpected git args: ${args}`);
		return { stdout: result };
	});
}

describe("normalizeGitHubRemoteUrl", () => {
	it.each([
		["git@github.com:cline/cline.git", "https://github.com/cline/cline"],
		["https://github.com/cline/cline.git", "https://github.com/cline/cline"],
		["ssh://git@github.com/cline/cline.git", "https://github.com/cline/cline"],
		["git://github.com/cline/cline", "https://github.com/cline/cline"],
	])("normalizes %s", (remote, expected) => {
		expect(normalizeGitHubRemoteUrl(remote)).toBe(expected);
	});

	it("rejects non-GitHub and nested paths", () => {
		expect(
			normalizeGitHubRemoteUrl("git@gitlab.com:cline/cline.git"),
		).toBeNull();
		expect(normalizeGitHubRemoteUrl("https://github.com/a/b/c.git")).toBeNull();
	});
});

describe("preflightCloudHandoffGit", () => {
	it("returns the exact pushed upstream context", async () => {
		const git = fakeGit();
		await expect(
			preflightCloudHandoffGit({ cwd: "/repo", git }),
		).resolves.toEqual({
			repoUrl: "https://github.com/cline/cline",
			branch: "feature/handoff",
			remoteName: "origin",
			headSha: HEAD,
		});
		expect(git).toHaveBeenCalledWith(
			[
				"status",
				"--porcelain=v1",
				"--untracked-files=all",
				"--ignore-submodules=none",
			],
			expect.objectContaining({ cwd: "/repo" }),
		);
	});

	it("preserves a workspace path relative to the repository root", async () => {
		await expect(
			preflightCloudHandoffGit({
				cwd: "/repo/apps/desktop",
				git: fakeGit({ "rev-parse --show-prefix": "apps/desktop/\n" }),
			}),
		).resolves.toEqual(
			expect.objectContaining({ workspaceRelativePath: "apps/desktop" }),
		);
	});

	it("preserves significant whitespace in repository-relative workspace paths", async () => {
		await expect(
			preflightCloudHandoffGit({
				cwd: "/repo/ leading ",
				git: fakeGit({ "rev-parse --show-prefix": " leading /\n" }),
			}),
		).resolves.toEqual(
			expect.objectContaining({ workspaceRelativePath: " leading " }),
		);
	});

	it("refuses tracked or untracked worktree changes with a compact summary", async () => {
		const dirty = Array.from(
			{ length: 8 },
			(_, index) => ` M changed-${index + 1}.ts`,
		).join("\n");
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"status --porcelain=v1 --untracked-files=all --ignore-submodules=none":
					dirty,
			}),
		}).catch((caught) => caught);

		expect(error).toBeInstanceOf(CloudHandoffGitPreflightError);
		expect(error.code).toBe("dirty_worktree");
		expect(error.message).toContain("Uncommitted files are not transferred");
		expect(error.message).toContain("changed-5.ts");
		expect(error.message).not.toContain("changed-6.ts");
		expect(error.message).toContain("...and 3 more");
	});

	it("classifies detached HEAD errors", async () => {
		const detached = Object.assign(new Error("not a symbolic ref"), {
			code: 1,
			stderr: "fatal: ref HEAD is not a symbolic ref",
		});
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"symbolic-ref --quiet --short HEAD": detached,
			}),
		}).catch((caught) => caught);

		expect(error.code).toBe("detached_head");
	});

	it("does not misclassify branch inspection failures as detached HEAD", async () => {
		const failed = Object.assign(new Error("git unavailable"), {
			code: 128,
			stderr: "fatal: unable to read repository",
		});
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({ "symbolic-ref --quiet --short HEAD": failed }),
		}).catch((caught) => caught);

		expect(error.code).toBe("git_command_failed");
		expect(error.message).toContain("Could not inspect");
	});

	it("refuses when local HEAD differs from the remote branch", async () => {
		const remoteHead = "b".repeat(40);
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"ls-remote --exit-code origin refs/heads/feature/handoff": `${remoteHead}\trefs/heads/feature/handoff\n`,
			}),
		}).catch((caught) => caught);

		expect(error.code).toBe("unpushed_commits");
		expect(error.message).toContain("Push the current commit");
	});

	it("distinguishes a missing remote ref from an authentication failure", async () => {
		const missing = Object.assign(new Error("missing"), { code: 2 });
		const missingError = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"ls-remote --exit-code origin refs/heads/feature/handoff": missing,
			}),
		}).catch((caught) => caught);
		expect(missingError.code).toBe("remote_branch_missing");

		const auth = Object.assign(new Error("auth"), {
			code: 128,
			stderr: "fatal: could not read Username",
		});
		const authError = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"ls-remote --exit-code origin refs/heads/feature/handoff": auth,
			}),
		}).catch((caught) => caught);
		expect(authError.code).toBe("git_command_failed");
		expect(authError.message).toContain("GitHub authentication");
	});

	it("refuses non-GitHub upstreams", async () => {
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({
				"remote get-url origin": "git@gitlab.com:cline/cline.git\n",
			}),
		}).catch((caught) => caught);

		expect(error.code).toBe("unsupported_remote");
	});

	it("does not echo credential-bearing remotes from git stderr", async () => {
		const secret = "github_pat_secret";
		const failed = Object.assign(new Error("bad remote"), {
			stderr: `fatal: No such remote 'https://${secret}@github.com/cline/cline.git'`,
		});
		const error = await preflightCloudHandoffGit({
			cwd: "/repo",
			git: fakeGit({ "remote get-url origin": failed }),
		}).catch((caught) => caught);

		expect(error.code).toBe("missing_upstream");
		expect(error.message).toBe("Could not resolve the upstream remote.");
		expect(error.message).not.toContain(secret);
		expect(error.cause).toBeUndefined();
	});

	it("supports a GitHub URL configured directly as the branch remote", async () => {
		const remote = "https://github_pat_secret@github.com/cline/cline.git";
		await expect(
			preflightCloudHandoffGit({
				cwd: "/repo",
				git: fakeGit({
					"config --get branch.feature/handoff.remote": remote,
					[`ls-remote --exit-code ${remote} refs/heads/feature/handoff`]: `${HEAD}\trefs/heads/feature/handoff\n`,
				}),
			}),
		).resolves.toEqual(
			expect.objectContaining({
				repoUrl: "https://github.com/cline/cline",
				remoteName: "https://github.com/cline/cline",
			}),
		);
	});
});
