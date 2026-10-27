import { describe, expect, it } from "vitest";
import { repositoryReviewUrl } from "./repository-review";

describe("repository review links", () => {
	it("opens the known branch comparison without embedding credentials", () => {
		expect(
			repositoryReviewUrl(
				"https://github.com/example/project.git",
				"cline/abc12345",
				"feature/mobile",
			),
		).toBe(
			"https://github.com/example/project/compare/feature%2Fmobile...cline%2Fabc12345?expand=1",
		);
		expect(repositoryReviewUrl("https://github.com/example/project")).toBe(
			"https://github.com/example/project/pulls",
		);
	});
	it("never treats the starting branch as the task branch", () => {
		expect(
			repositoryReviewUrl(
				"https://github.com/example/project",
				undefined,
				"main",
			),
		).toBe("https://github.com/example/project/pulls");
		expect(
			repositoryReviewUrl(
				"https://github.com/example/project",
				"cline/12345678",
				"main",
			),
		).toBe(
			"https://github.com/example/project/compare/main...cline%2F12345678?expand=1",
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
