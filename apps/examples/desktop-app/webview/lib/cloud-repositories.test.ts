import { describe, expect, it } from "vitest";
import {
	isGitHubRepositoryUrl,
	normalizeCloudRepositoryUrl,
	preferredCloudBranch,
} from "./cloud-repositories";

describe("cloud repository selection", () => {
	it("accepts GitHub repository URLs but not arbitrary URLs", () => {
		expect(isGitHubRepositoryUrl("https://github.com/cline/cline")).toBe(true);
		expect(isGitHubRepositoryUrl("git@github.com:cline/cline.git")).toBe(false);
		expect(isGitHubRepositoryUrl("https://github.com/cline")).toBe(false);
		expect(isGitHubRepositoryUrl("https://example.com/cline/cline")).toBe(
			false,
		);
	});

	it("normalizes repository URLs returned by the integration API", () => {
		expect(
			normalizeCloudRepositoryUrl(" https://github.com/cline/cline/ "),
		).toBe("https://github.com/cline/cline");
	});

	it("prefers the saved default branch, then common defaults, then the first branch", () => {
		expect(preferredCloudBranch(["release", "main"], "trunk")).toBe("main");
		expect(preferredCloudBranch(["release", "master"], "trunk")).toBe("master");
		expect(preferredCloudBranch(["release", "main"], "release")).toBe(
			"release",
		);
		expect(preferredCloudBranch(["develop"], "")).toBe("develop");
	});
});
