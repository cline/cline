// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	EXECUTION_TARGET_STORAGE_KEY,
	parseExecutionTargetSelection,
	readExecutionTargetSelectionFromWindow,
	writeCloudBranchToWindow,
	writeCloudModelToWindow,
	writeCloudRepoUrlToWindow,
	writeExecutionTargetToWindow,
} from "./execution-target-selection";

const empty = {
	target: "local",
	cloudModel: "",
	cloudRepoUrl: "",
	cloudBranch: "",
};

describe("parseExecutionTargetSelection", () => {
	it("defaults to local with nothing remembered", () => {
		expect(parseExecutionTargetSelection(null)).toEqual(empty);
		expect(parseExecutionTargetSelection("")).toEqual(empty);
	});

	it("only accepts cloud as a non-default target", () => {
		expect(
			parseExecutionTargetSelection(
				JSON.stringify({
					target: "cloud",
					cloudModel: " cloud-model ",
					cloudRepoUrl: " https://github.com/cline/cline ",
					cloudBranch: " main ",
				}),
			),
		).toEqual({
			target: "cloud",
			cloudModel: "cloud-model",
			cloudRepoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
		});
		expect(
			parseExecutionTargetSelection(JSON.stringify({ target: "remote" })),
		).toEqual(empty);
	});

	it("drops a branch that has no repo", () => {
		expect(
			parseExecutionTargetSelection(JSON.stringify({ cloudBranch: "main" })),
		).toEqual(empty);
	});

	it("ignores malformed storage", () => {
		expect(parseExecutionTargetSelection("{not json")).toEqual(empty);
		expect(parseExecutionTargetSelection("[]")).toEqual(empty);
		expect(
			parseExecutionTargetSelection(
				JSON.stringify({ cloudModel: 42, cloudRepoUrl: null }),
			),
		).toEqual(empty);
	});
});

describe("execution target storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("remembers the target and the cloud picks independently", () => {
		writeExecutionTargetToWindow("cloud");
		expect(readExecutionTargetSelectionFromWindow()).toEqual({
			...empty,
			target: "cloud",
		});

		writeCloudModelToWindow("cloud-model");
		writeCloudRepoUrlToWindow("https://github.com/cline/cline");
		writeCloudBranchToWindow("dev");
		expect(readExecutionTargetSelectionFromWindow()).toEqual({
			target: "cloud",
			cloudModel: "cloud-model",
			cloudRepoUrl: "https://github.com/cline/cline",
			cloudBranch: "dev",
		});

		// Going back to Local keeps the cloud picks for the next Cloud pick.
		writeExecutionTargetToWindow("local");
		expect(
			JSON.parse(
				window.localStorage.getItem(EXECUTION_TARGET_STORAGE_KEY) ?? "",
			),
		).toEqual({
			target: "local",
			cloudModel: "cloud-model",
			cloudRepoUrl: "https://github.com/cline/cline",
			cloudBranch: "dev",
		});
	});

	it("forgets the branch when the repo changes, but not when it is re-picked", () => {
		writeCloudRepoUrlToWindow("https://github.com/cline/cline");
		writeCloudBranchToWindow("dev");
		writeCloudRepoUrlToWindow("https://github.com/cline/cline");
		expect(readExecutionTargetSelectionFromWindow().cloudBranch).toBe("dev");

		writeCloudRepoUrlToWindow("https://github.com/cline/other");
		expect(readExecutionTargetSelectionFromWindow()).toMatchObject({
			cloudRepoUrl: "https://github.com/cline/other",
			cloudBranch: "",
		});

		// Clearing the repo clears the branch with it.
		writeCloudRepoUrlToWindow("");
		expect(readExecutionTargetSelectionFromWindow()).toMatchObject({
			cloudRepoUrl: "",
			cloudBranch: "",
		});
	});
});
