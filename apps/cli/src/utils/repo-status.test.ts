import { describe, expect, it } from "vitest";
import { isSameRepoStatus } from "./repo-status";

describe("isSameRepoStatus", () => {
	it("treats identical statuses as equal", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
			),
		).toBe(true);
		expect(
			isSameRepoStatus(
				{ branch: null, diffStats: null },
				{ branch: null, diffStats: null },
			),
		).toBe(true);
	});

	it("detects branch and diff changes", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "feature", diffStats: null },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "main", diffStats: { files: 1, additions: 0, deletions: 0 } },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 4 } },
			),
		).toBe(false);
	});
});
