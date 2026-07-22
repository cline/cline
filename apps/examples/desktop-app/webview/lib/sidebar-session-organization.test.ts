import { describe, expect, it } from "vitest";
import type { SessionThread } from "@/hooks/use-session-history";
import {
	groupThreadsByProject,
	workspaceDisplayName,
} from "./sidebar-session-organization";

function thread(
	id: string,
	workspacePath: string,
	overrides: Partial<SessionThread> = {},
): SessionThread {
	return {
		id,
		title: id,
		codebase: workspaceDisplayName(workspacePath),
		workspacePath,
		time: "now",
		provider: "cline",
		model: "test-model",
		status: "completed",
		...overrides,
	};
}

describe("sidebar session organization", () => {
	it("groups every loaded thread before applying per-project visibility", () => {
		const threads = [
			...Array.from({ length: 12 }, (_, index) =>
				thread(`alpha-${index + 1}`, "/work/acme/repo"),
			),
			thread("beta-1", "/work/other/repo"),
		];

		const groups = groupThreadsByProject(threads);

		expect(groups.map((group) => group.label)).toEqual([
			"acme/repo",
			"other/repo",
		]);
		expect(groups[0]?.threads).toHaveLength(12);
		expect(groups[1]?.threads.map((item) => item.id)).toEqual(["beta-1"]);
	});

	it("uses the repository directory instead of the full workspace path", () => {
		expect(workspaceDisplayName("/Users/saoud/code/cline/")).toBe("cline");
		expect(workspaceDisplayName("C:\\Users\\saoud\\code\\cline\\")).toBe(
			"cline",
		);
	});

	it("labels temporary workspace groups as New Project", () => {
		const path = "/tmp/cline/sessions/session-a1b2c3-temp/project";
		expect(workspaceDisplayName(path)).toBe("New Project");
		expect(groupThreadsByProject([thread("temp", path)])[0]?.label).toBe(
			"New Project",
		);
	});
});
