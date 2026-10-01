import { expect, it, vi } from "vitest";
import { createPullRequestStatusReader } from "./pull-request";

it("allows repository-scoped authentication without the desktop account probe", async () => {
	const run = vi.fn(async (file: string, args: string[]) => {
		if (file === "git")
			return args[0] === "branch"
				? "feature/work"
				: "https://github.com/owner/repo.git";
		if (args[0] === "auth")
			throw Object.assign(new Error("Installation tokens have no user"), {
				code: 1,
			});
		if (args[0] === "repo")
			return JSON.stringify({ defaultBranchRef: { name: "main" } });
		return "[]";
	});
	expect(await createPullRequestStatusReader({ run })("/workspace")).toBeNull();
	run.mockClear();
	expect(
		await createPullRequestStatusReader({ run, probeAuthentication: false })(
			"/workspace",
		),
	).toMatchObject({
		repository: "owner/repo",
		branch: "feature/work",
		pullRequest: null,
		createUrl:
			"https://github.com/owner/repo/compare/main...feature%2Fwork?expand=1",
	});
	expect(run.mock.calls.some(([, args]) => args[0] === "auth")).toBe(false);
	expect(
		run.mock.calls.some(([file, args]) => file === "gh" && args[0] === "repo"),
	).toBe(true);
});
