import { describe, expect, it } from "vitest";
import { parseGitHubRepoFullName } from "./repo-status";

describe("parseGitHubRepoFullName", () => {
	it.each([
		["https://github.com/cline/cline.git", "cline/cline"],
		["https://github.com/Cline/Cline", "cline/cline"],
		["git@github.com:cline/cline.git", "cline/cline"],
		["ssh://git@github.com/cline/cline-docs/", "cline/cline-docs"],
		["https://x-access-token:secret@github.com/cline/cline.git", "cline/cline"],
	])("reads %s", (remote, expected) => {
		expect(parseGitHubRepoFullName(remote)).toBe(expected);
	});

	it.each([
		undefined,
		"",
		"https://gitlab.com/cline/cline.git",
	])("ignores %s", (remote) => {
		expect(parseGitHubRepoFullName(remote)).toBeUndefined();
	});
});
