import { describe, expect, it } from "vitest";
import {
	mergeWorkspacePaths,
	normalizeWorkspacePath,
	parseWorkspaceSelectionStorage,
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
});
