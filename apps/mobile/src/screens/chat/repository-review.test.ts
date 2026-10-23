import { describe, expect, it } from "vitest";
import { repositoryReviewUrl } from "./repository-review";

describe("repository review links", () => {
	it("opens the known branch comparison without embedding credentials", () => {
		expect(
			repositoryReviewUrl(
				"https://github.com/example/project.git",
				"feature/mobile",
			),
		).toBe(
			"https://github.com/example/project/compare/feature%2Fmobile?expand=1",
		);
		expect(repositoryReviewUrl("https://github.com/example/project")).toBe(
			"https://github.com/example/project/pulls",
		);
	});
	it("does not navigate unknown origins, credentials or non-repository paths", () => {
		for (const url of [
			"https://github.com.evil.test/example/project",
			"http://github.com/example/project",
			"https://token@github.com/example/project",
			"https://github.com/example/project/issues/1",
			"not a url",
		]) {
			expect(repositoryReviewUrl(url)).toBeUndefined();
		}
	});
});
