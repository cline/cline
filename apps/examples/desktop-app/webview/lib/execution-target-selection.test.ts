// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	EXECUTION_TARGET_STORAGE_KEY,
	parseExecutionTargetSelection,
	readExecutionTargetSelectionFromWindow,
	writeCloudModelToWindow,
	writeExecutionTargetToWindow,
} from "./execution-target-selection";

describe("parseExecutionTargetSelection", () => {
	it("defaults to local with no cloud model", () => {
		expect(parseExecutionTargetSelection(null)).toEqual({
			target: "local",
			cloudModel: "",
		});
		expect(parseExecutionTargetSelection("")).toEqual({
			target: "local",
			cloudModel: "",
		});
	});

	it("only accepts cloud as a non-default target", () => {
		expect(
			parseExecutionTargetSelection(
				JSON.stringify({ target: "cloud", cloudModel: " cloud-model " }),
			),
		).toEqual({ target: "cloud", cloudModel: "cloud-model" });
		expect(
			parseExecutionTargetSelection(JSON.stringify({ target: "remote" })),
		).toEqual({ target: "local", cloudModel: "" });
	});

	it("ignores malformed storage", () => {
		expect(parseExecutionTargetSelection("{not json")).toEqual({
			target: "local",
			cloudModel: "",
		});
		expect(parseExecutionTargetSelection("[]")).toEqual({
			target: "local",
			cloudModel: "",
		});
		expect(
			parseExecutionTargetSelection(JSON.stringify({ cloudModel: 42 })),
		).toEqual({ target: "local", cloudModel: "" });
	});
});

describe("execution target storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("remembers the target and the cloud model independently", () => {
		writeExecutionTargetToWindow("cloud");
		expect(readExecutionTargetSelectionFromWindow()).toEqual({
			target: "cloud",
			cloudModel: "",
		});

		writeCloudModelToWindow("cloud-model");
		expect(readExecutionTargetSelectionFromWindow()).toEqual({
			target: "cloud",
			cloudModel: "cloud-model",
		});

		// Going back to Local keeps the cloud model for the next Cloud pick.
		writeExecutionTargetToWindow("local");
		expect(
			JSON.parse(
				window.localStorage.getItem(EXECUTION_TARGET_STORAGE_KEY) ?? "",
			),
		).toEqual({ target: "local", cloudModel: "cloud-model" });
	});
});
