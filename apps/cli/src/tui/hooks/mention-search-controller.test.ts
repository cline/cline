import { describe, expect, it } from "vitest";
import { createMentionSearchController } from "./mention-search-controller";

describe("TUI workspace mention search", () => {
	it("keeps only the latest search in one workspace current", () => {
		const controller = createMentionSearchController("/workspace-a");
		const firstSearch = controller.startSearch();
		const secondSearch = controller.startSearch();

		expect(controller.isCurrent(firstSearch)).toBe(false);
		expect(controller.isCurrent(secondSearch)).toBe(true);
	});

	it("keeps a search current when the notifier repeats the same workspace", () => {
		const controller = createMentionSearchController("/workspace-a");
		const search = controller.startSearch();

		expect(controller.setWorkspaceRoot("/workspace-a")).toBe(false);
		expect(controller.isCurrent(search)).toBe(true);
	});

	it("rejects an old workspace result as soon as the workspace changes", () => {
		const controller = createMentionSearchController("/workspace-a");
		const workspaceASearch = controller.startSearch();

		expect(controller.setWorkspaceRoot("/workspace-b")).toBe(true);
		expect(controller.isCurrent(workspaceASearch)).toBe(false);

		const workspaceBSearch = controller.startSearch();
		expect(workspaceBSearch.workspaceRoot).toBe("/workspace-b");
		expect(controller.isCurrent(workspaceBSearch)).toBe(true);
	});

	it("does not revive a stale search when returning to its workspace", () => {
		const controller = createMentionSearchController("/workspace-a");
		const staleSearch = controller.startSearch();

		controller.setWorkspaceRoot("/workspace-b");
		controller.setWorkspaceRoot("/workspace-a");

		expect(controller.isCurrent(staleSearch)).toBe(false);
	});
});
