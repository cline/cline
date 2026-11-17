import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFactoryAddProjectTool } from "./factory-add-project-tool";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function setup(options: { manager?: boolean; approved?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), "factory-add-project-tool-"));
	roots.push(root);
	const repo = join(root, "todo-app");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q"], { cwd: repo });
	const projects: string[] = [];
	const addProject = vi.fn(async (workspaceRoot: string) => {
		projects.push(workspaceRoot);
	});
	const confirm = vi.fn(async () => ({ approved: options.approved === true }));
	const tool = createFactoryAddProjectTool({
		resolveManagerSession: async () =>
			options.manager === false ? undefined : {},
		listProjects: async () => projects,
		addProject,
		confirm,
	});
	const run = (path: string) =>
		tool.execute({ path } as never, {
			agentId: "a",
			iteration: 1,
			sessionId: "chat",
			toolCallId: "c",
		}) as unknown as Promise<Record<string, unknown>>;
	return { root, repo, addProject, confirm, run };
}

describe("factory_add_project", () => {
	it("adds the project only after the person confirms it", async () => {
		const declined = setup({ approved: false });
		await expect(declined.run(declined.repo)).resolves.toMatchObject({
			ok: false,
			error: { code: "factory_add_project_not_confirmed" },
		});
		expect(declined.confirm).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "todo-app",
				workspaceRoot: declined.repo,
			}),
		);
		expect(declined.addProject).not.toHaveBeenCalled();

		const confirmed = setup({ approved: true });
		await expect(confirmed.run(confirmed.repo)).resolves.toMatchObject({
			ok: true,
			project: "todo-app",
			workspaceRoot: confirmed.repo,
		});
		expect(confirmed.addProject).toHaveBeenCalledWith(confirmed.repo);
	});

	it("refuses without asking outside the manager chat or for a folder that is not a repository", async () => {
		const other = setup({ manager: false, approved: true });
		await expect(other.run(other.repo)).resolves.toMatchObject({
			ok: false,
			error: { code: "factory_add_project_unavailable" },
		});
		const manager = setup({ approved: true });
		const plain = join(manager.root, "notes");
		mkdirSync(plain);
		for (const path of [plain, "todo-app", join(manager.root, "missing")])
			await expect(manager.run(path)).resolves.toMatchObject({
				ok: false,
				error: { code: "factory_invalid_project" },
			});
		for (const { confirm, addProject } of [other, manager]) {
			expect(confirm).not.toHaveBeenCalled();
			expect(addProject).not.toHaveBeenCalled();
		}
	});
});
