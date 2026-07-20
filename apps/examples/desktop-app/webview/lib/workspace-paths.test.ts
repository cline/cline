import { afterEach, describe, expect, it } from "vitest";
import {
	filterWorkspacePaths,
	isExcludedWorkspacePath,
	mergeWorkspacePaths,
	normalizeWorkspacePath,
	parseWorkspaceSelectionStorage,
	registerHostHomeDirectory,
	workspacePathsFromSessions,
} from "./workspace-paths";

describe("workspace paths", () => {
	it("normalizes trailing separators and Windows path casing", () => {
		expect(normalizeWorkspacePath(" /workspace/cline/ ")).toBe(
			"/workspace/cline",
		);
		expect(normalizeWorkspacePath("C:\\Users\\Saoud\\Cline\\")).toBe(
			"c:\\users\\saoud\\cline",
		);
		expect(normalizeWorkspacePath("/")).toBe("/");
	});

	it("retains known projects when discovery returns an incomplete subset", () => {
		const known = ["/projects/a", "/projects/b", "/projects/c", "/projects/d"];
		const afterFirstPick = mergeWorkspacePaths(known, [
			"/projects/e",
			"/projects/a/",
		]);
		const afterSecondPick = mergeWorkspacePaths(afterFirstPick, [
			"/projects/f",
			"/projects/b",
		]);

		expect(afterFirstPick).toEqual([
			"/projects/a",
			"/projects/b",
			"/projects/c",
			"/projects/d",
			"/projects/e",
		]);
		expect(afterSecondPick).toEqual([
			"/projects/a",
			"/projects/b",
			"/projects/c",
			"/projects/d",
			"/projects/e",
			"/projects/f",
		]);
	});

	it("keeps the first-seen order so earlier groups rank first", () => {
		expect(
			mergeWorkspacePaths(["/projects/zulu", "/projects/mike"], [
				"/projects/alpha",
				"/projects/zulu/",
			]),
		).toEqual(["/projects/zulu", "/projects/mike", "/projects/alpha"]);
	});

	it("orders the catalog by the most recent session in each workspace", () => {
		const paths = workspacePathsFromSessions([
			{ workspaceRoot: "/projects/old", startedAt: "2026-01-05T00:00:00Z" },
			{
				workspaceRoot: "/projects/active",
				startedAt: "2026-02-01T00:00:00Z",
				endedAt: "2026-02-01T01:00:00Z",
			},
			{ workspaceRoot: "/projects/old", startedAt: "2026-03-01T00:00:00Z" },
			{ workspaceRoot: "/projects/mid", startedAt: "2026-02-15T00:00:00Z" },
			{ workspaceRoot: "/projects/undated" },
		]);

		expect(paths).toEqual([
			"/projects/old",
			"/projects/mid",
			"/projects/active",
			"/projects/undated",
		]);
	});

	it("builds the project catalog from every loaded history workspace", () => {
		const sessions = Array.from({ length: 25 }, (_, index) => ({
			workspaceRoot: `/projects/project-${String(index + 1).padStart(2, "0")}`,
		}));
		sessions.push({ workspaceRoot: "/projects/project-01/" });

		const paths = workspacePathsFromSessions(sessions);

		expect(paths).toHaveLength(25);
		expect(paths).toContain("/projects/project-25");
	});

	it("restores the selected project and catalog across thread remounts", () => {
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					lastWorkspace: "/projects/selected/",
					workspaces: ["/projects/one", "/projects/selected"],
				}),
			),
		).toEqual({
			lastWorkspace: "/projects/selected/",
			workspaces: ["/projects/one", "/projects/selected"],
		});
		expect(parseWorkspaceSelectionStorage("not json")).toEqual({
			lastWorkspace: "",
			workspaces: [],
		});
	});

	it("excludes .cline-internal paths from the workspace catalog", () => {
		expect(
			isExcludedWorkspacePath("/Users/beatrix/.cline/worktrees/5e0b3/sdk-wip"),
		).toBe(true);
		expect(
			isExcludedWorkspacePath(
				"/Users/beatrix/.cline/plugins/_installed/git/github.com/example-plugin",
			),
		).toBe(true);
		expect(
			isExcludedWorkspacePath("C:\\Users\\Saoud\\.cline\\worktrees\\abc"),
		).toBe(true);
	});

	describe("with a registered host home directory", () => {
		afterEach(() => {
			registerHostHomeDirectory("");
		});

		it("excludes a non-standard home and its Desktop but keeps projects inside them", () => {
			registerHostHomeDirectory("/srv/homes/bea/");

			expect(isExcludedWorkspacePath("/srv/homes/bea")).toBe(true);
			expect(isExcludedWorkspacePath("/srv/homes/bea/Desktop")).toBe(true);
			expect(isExcludedWorkspacePath("/srv/homes/bea/projects/app")).toBe(
				false,
			);
			expect(isExcludedWorkspacePath("/srv/homes/beatrix")).toBe(false);
		});

		it("matches Windows homes case-insensitively", () => {
			registerHostHomeDirectory("D:\\Homes\\Bea");

			expect(isExcludedWorkspacePath("d:\\homes\\bea\\")).toBe(true);
			expect(isExcludedWorkspacePath("D:\\Homes\\Bea\\Desktop")).toBe(true);
			expect(isExcludedWorkspacePath("D:\\Homes\\Bea\\cline")).toBe(false);
		});
	});

	it("excludes home and Desktop directories but keeps projects inside them", () => {
		expect(isExcludedWorkspacePath("/Users/beatrix")).toBe(true);
		expect(isExcludedWorkspacePath("/Users/beatrix/Desktop/")).toBe(true);
		expect(isExcludedWorkspacePath("/home/beatrix")).toBe(true);
		expect(isExcludedWorkspacePath("/root")).toBe(true);
		expect(isExcludedWorkspacePath("C:\\Users\\Saoud")).toBe(true);
		expect(isExcludedWorkspacePath("C:\\Users\\Saoud\\Desktop")).toBe(true);

		expect(isExcludedWorkspacePath("/Users/beatrix/dev/cline")).toBe(false);
		expect(isExcludedWorkspacePath("/Users/beatrix/Desktop/my-app")).toBe(
			false,
		);
		expect(isExcludedWorkspacePath("/home/beatrix/projects")).toBe(false);
		expect(isExcludedWorkspacePath("/workspace/cline")).toBe(false);
		expect(isExcludedWorkspacePath("C:\\Users\\Saoud\\Cline")).toBe(false);
	});

	it("filters excluded paths out of session-derived workspaces", () => {
		const paths = workspacePathsFromSessions([
			{ workspaceRoot: "/projects/app" },
			{ workspaceRoot: "/Users/beatrix/.cline/worktrees/97815/sdk-wip" },
			{ cwd: "/Users/beatrix/Desktop" },
			{ cwd: "/Users/beatrix" },
			{ cwd: "/projects/tool" },
		]);

		expect(paths).toEqual(["/projects/app", "/projects/tool"]);
	});

	it("scrubs excluded paths from the stored catalog while keeping the selection", () => {
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					lastWorkspace: "/Users/beatrix/Desktop",
					workspaces: [
						"/projects/one",
						"/Users/beatrix/.cline/worktrees/5e0b3/sdk-wip",
						"/Users/beatrix",
					],
				}),
			),
		).toEqual({
			lastWorkspace: "/Users/beatrix/Desktop",
			workspaces: ["/projects/one"],
		});
		expect(
			filterWorkspacePaths(["/projects/one", "/Users/beatrix/Desktop"]),
		).toEqual(["/projects/one"]);
	});
});
