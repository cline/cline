// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	CLOUD_REPOSITORIES_STORAGE_KEY,
	isGitHubRepositoryUrl,
	parseRecentCloudRepositories,
	rememberCloudRepository,
} from "./cloud-repositories";

beforeEach(() => {
	const values = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
			clear: () => values.clear(),
		},
	});
});

describe("cloud repository selection", () => {
	it("accepts GitHub repository URLs but not arbitrary URLs", () => {
		expect(isGitHubRepositoryUrl("https://github.com/cline/cline")).toBe(true);
		expect(isGitHubRepositoryUrl("git@github.com:cline/cline.git")).toBe(false);
		expect(isGitHubRepositoryUrl("https://github.com/cline")).toBe(false);
		expect(isGitHubRepositoryUrl("https://example.com/cline/cline")).toBe(
			false,
		);
	});

	it("keeps five unique valid repositories with the newest first", () => {
		for (let index = 0; index < 7; index += 1) {
			rememberCloudRepository(`https://github.com/cline/repo-${index}/`);
		}
		rememberCloudRepository("https://github.com/cline/repo-4");

		expect(
			parseRecentCloudRepositories(
				window.localStorage.getItem(CLOUD_REPOSITORIES_STORAGE_KEY),
			),
		).toEqual([
			"https://github.com/cline/repo-4",
			"https://github.com/cline/repo-6",
			"https://github.com/cline/repo-5",
			"https://github.com/cline/repo-3",
			"https://github.com/cline/repo-2",
		]);
	});

	it("ignores malformed persisted values", () => {
		expect(parseRecentCloudRepositories("not json")).toEqual([]);
		expect(
			parseRecentCloudRepositories(
				JSON.stringify(["https://example.com/nope/repo", 42]),
			),
		).toEqual([]);
	});
});
