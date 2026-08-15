// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	filterWorkspacePaths,
	isAbsoluteFilePath,
	isExcludedWorkspacePath,
	looksLikeFolderPath,
	mergeWorkspacePaths,
	normalizeWorkspacePath,
	parseWorkspaceSelectionStorage,
	readWorkspaceSelectionFromWindow,
	registerHostHomeDirectory,
	resolveWorkspaceFilePath,
	WORKSPACE_SELECTION_STORAGE_KEY,
	workspacePathsFromSessions,
	writeWorkspaceSelectionToWindow,
} from "./workspace-paths";

describe("workspace paths", () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: {
				clear: () => values.clear(),
				getItem: (key: string) => values.get(key) ?? null,
				removeItem: (key: string) => values.delete(key),
				setItem: (key: string, value: string) => values.set(key, value),
			},
		});
	});

	it("recognizes typed folder paths for manual entry", () => {
		expect(looksLikeFolderPath("/home/user/projects")).toBe(true);
		expect(looksLikeFolderPath(" /home/user/projects/ ")).toBe(true);
		expect(looksLikeFolderPath("~")).toBe(true);
		expect(looksLikeFolderPath("~/documents")).toBe(true);
		expect(looksLikeFolderPath("C:\\Users\\me\\code")).toBe(true);
		expect(looksLikeFolderPath("D:/projects")).toBe(true);
		expect(looksLikeFolderPath("my-project")).toBe(false);
		expect(looksLikeFolderPath("search text")).toBe(false);
		expect(looksLikeFolderPath("")).toBe(false);
	});

	it("normalizes trailing separators and Windows path casing", () => {
		expect(normalizeWorkspacePath(" /workspace/cline/ ")).toBe(
			"/workspace/cline",
		);
		expect(normalizeWorkspacePath("C:\\Users\\Saoud\\Cline\\")).toBe(
			"c:\\users\\saoud\\cline",
		);
		expect(normalizeWorkspacePath("/")).toBe("/");
	});

	it("detects absolute file paths across platforms", () => {
		expect(isAbsoluteFilePath("/Users/renee/cline/docs/a.mdx")).toBe(true);
		expect(isAbsoluteFilePath("C:\\Users\\renee\\a.mdx")).toBe(true);
		expect(isAbsoluteFilePath("C:/Users/renee/a.mdx")).toBe(true);
		expect(isAbsoluteFilePath("\\\\server\\share\\a.mdx")).toBe(true);
		expect(isAbsoluteFilePath("docs/a.mdx")).toBe(false);
		expect(isAbsoluteFilePath("./docs/a.mdx")).toBe(false);
	});

	it("resolves relative diff paths against the session cwd", () => {
		expect(resolveWorkspaceFilePath("docs/a.mdx", "/Users/renee/cline")).toBe(
			"/Users/renee/cline/docs/a.mdx",
		);
		expect(
			resolveWorkspaceFilePath("./docs/a.mdx", "/Users/renee/cline/"),
		).toBe("/Users/renee/cline/docs/a.mdx");
		expect(
			resolveWorkspaceFilePath("/Users/renee/cline/docs/a.mdx", "/elsewhere"),
		).toBe("/Users/renee/cline/docs/a.mdx");
		expect(resolveWorkspaceFilePath("docs/a.mdx", undefined)).toBe(
			"docs/a.mdx",
		);
		expect(resolveWorkspaceFilePath("docs\\a.mdx", "C:\\Users\\renee")).toBe(
			"C:\\Users\\renee\\docs\\a.mdx",
		);
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
			mergeWorkspacePaths(
				["/projects/zulu", "/projects/mike"],
				["/projects/alpha", "/projects/zulu/"],
			),
		).toEqual(["/projects/zulu", "/projects/mike", "/projects/alpha"]);
	});

	it("orders the catalog by the most recent session in each workspace", () => {
		const paths = workspacePathsFromSessions(
			[
				{
					workspaceRoot: "/projects/old",
					startedAt: "2026-01-05T00:00:00Z",
					environmentId: "local",
				},
				{
					workspaceRoot: "/projects/active",
					startedAt: "2026-02-01T00:00:00Z",
					endedAt: "2026-02-01T01:00:00Z",
					environmentId: "local",
				},
				{
					workspaceRoot: "/projects/old",
					startedAt: "2026-03-01T00:00:00Z",
					environmentId: "local",
				},
				{
					workspaceRoot: "/projects/mid",
					startedAt: "2026-02-15T00:00:00Z",
					environmentId: "local",
				},
				{ workspaceRoot: "/projects/undated", environmentId: "local" },
			],
			"local",
		);

		expect(paths).toEqual([
			"/projects/old",
			"/projects/mid",
			"/projects/active",
			"/projects/undated",
		]);
	});

	it("excludes cloud sessions so /workspace never pollutes local recents", () => {
		const paths = workspacePathsFromSessions([
			{ workspaceRoot: "/projects/local", startedAt: "2026-02-01T00:00:00Z" },
			{
				workspaceRoot: "/workspace",
				cwd: "/workspace",
				origin: "cloud",
				startedAt: "2026-03-01T00:00:00Z",
			},
		]);

		expect(paths).toEqual(["/projects/local"]);
	});

	it("builds the project catalog from every loaded history workspace", () => {
		const sessions = Array.from({ length: 25 }, (_, index) => ({
			workspaceRoot: `/projects/project-${String(index + 1).padStart(2, "0")}`,
			environmentId: "local",
		}));
		sessions.push({
			workspaceRoot: "/projects/project-01/",
			environmentId: "local",
		});

		const paths = workspacePathsFromSessions(sessions, "local");

		expect(paths).toHaveLength(25);
		expect(paths).toContain("/projects/project-25");
	});

	it("restores the selected project and catalog across thread remounts", () => {
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					environments: {
						local: {
							lastWorkspace: "/projects/selected/",
							workspaces: ["/projects/one", "/projects/selected"],
						},
					},
				}),
				"local",
			),
		).toEqual({
			lastWorkspace: "/projects/selected/",
			workspaces: ["/projects/one", "/projects/selected"],
		});
		expect(parseWorkspaceSelectionStorage("not json", "local")).toEqual({
			lastWorkspace: "",
			workspaces: [],
		});
	});

	it("does not interpret path-only v1 data as an environment selection", () => {
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					lastWorkspace: "/projects/legacy",
					workspaces: ["/projects/legacy"],
				}),
				"local",
			),
		).toEqual({ lastWorkspace: "", workspaces: [] });
	});

	it("reads and writes each environment without replacing the others", () => {
		writeWorkspaceSelectionToWindow("local", {
			lastWorkspace: "/Users/dev/local-app",
			workspaces: ["/Users/dev/local-app"],
		});
		writeWorkspaceSelectionToWindow("pi-host", {
			lastWorkspace: "/home/pi/remote-app",
			workspaces: ["/home/pi/other-app", "/home/pi/remote-app"],
		});

		expect(readWorkspaceSelectionFromWindow("local")).toEqual({
			lastWorkspace: "/Users/dev/local-app",
			workspaces: ["/Users/dev/local-app"],
		});
		expect(readWorkspaceSelectionFromWindow("pi-host")).toEqual({
			lastWorkspace: "/home/pi/remote-app",
			workspaces: ["/home/pi/other-app", "/home/pi/remote-app"],
		});
		expect(
			JSON.parse(
				window.localStorage.getItem(WORKSPACE_SELECTION_STORAGE_KEY) ?? "{}",
			),
		).toEqual({
			environments: {
				local: {
					lastWorkspace: "/Users/dev/local-app",
					workspaces: ["/Users/dev/local-app"],
				},
				"pi-host": {
					lastWorkspace: "/home/pi/remote-app",
					workspaces: ["/home/pi/other-app", "/home/pi/remote-app"],
				},
			},
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

	it("excludes the SDK chat workspace from discovery and stored selections", () => {
		const temporaryWorkspace = "/home/host/.cline/data/workspaces/chat";

		expect(isExcludedWorkspacePath(temporaryWorkspace)).toBe(true);
		expect(
			workspacePathsFromSessions(
				[
					{ workspaceRoot: temporaryWorkspace, environmentId: "local" },
					{ workspaceRoot: "/projects/app", environmentId: "local" },
				],
				"local",
			),
		).toEqual(["/projects/app"]);
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					environments: {
						local: {
							lastWorkspace: temporaryWorkspace,
							workspaces: [temporaryWorkspace, "/projects/app"],
						},
					},
				}),
				"local",
			),
		).toEqual({
			lastWorkspace: "",
			workspaces: ["/projects/app"],
		});
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
		const paths = workspacePathsFromSessions(
			[
				{ workspaceRoot: "/projects/app", environmentId: "local" },
				{
					workspaceRoot: "/Users/beatrix/.cline/worktrees/97815/sdk-wip",
					environmentId: "local",
				},
				{ cwd: "/Users/beatrix/Desktop", environmentId: "local" },
				{ cwd: "/Users/beatrix", environmentId: "local" },
				{ cwd: "/projects/tool", environmentId: "local" },
			],
			"local",
		);

		expect(paths).toEqual(["/projects/app", "/projects/tool"]);
	});

	it("scrubs excluded paths from the stored catalog while keeping the selection", () => {
		expect(
			parseWorkspaceSelectionStorage(
				JSON.stringify({
					environments: {
						local: {
							lastWorkspace: "/Users/beatrix/Desktop",
							workspaces: [
								"/projects/one",
								"/Users/beatrix/.cline/worktrees/5e0b3/sdk-wip",
								"/Users/beatrix",
							],
						},
					},
				}),
				"local",
			),
		).toEqual({
			lastWorkspace: "/Users/beatrix/Desktop",
			workspaces: ["/projects/one"],
		});
		expect(
			filterWorkspacePaths(["/projects/one", "/Users/beatrix/Desktop"]),
		).toEqual(["/projects/one"]);
	});

	it("scopes stored and session-derived workspaces by environment", () => {
		const raw = JSON.stringify({
			environments: {
				local: {
					lastWorkspace: "/Users/dev/local-app",
					workspaces: ["/Users/dev/local-app"],
				},
				"pi-host": {
					lastWorkspace: "/home/pi/remote-app",
					workspaces: ["/home/pi/remote-app"],
				},
			},
		});

		expect(parseWorkspaceSelectionStorage(raw, "local").workspaces).toEqual([
			"/Users/dev/local-app",
		]);
		expect(parseWorkspaceSelectionStorage(raw, "pi-host").workspaces).toEqual([
			"/home/pi/remote-app",
		]);
		expect(
			workspacePathsFromSessions(
				[
					{ workspaceRoot: "/Users/dev/local-app", environmentId: "local" },
					{
						workspaceRoot: "/home/pi/remote-app",
						environmentId: "pi-host",
					},
					{
						workspaceRoot: "/home/other/app",
						environmentId: "other-host",
					},
				],
				"pi-host",
			),
		).toEqual(["/home/pi/remote-app"]);
	});
});
