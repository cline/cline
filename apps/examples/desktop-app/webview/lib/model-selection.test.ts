// @vitest-environment jsdom

import { beforeEach, expect, it } from "vitest";
import {
	EXECUTION_TARGET_STORAGE_KEY,
	readExecutionTargetFromWindow,
	readModelSelectionStorageFromWindow,
	writeExecutionTargetToWindow,
	writeModelSelectionStorageToWindow,
} from "./model-selection";

beforeEach(() => window.localStorage.clear());

it.each([
	"null",
	"[]",
	"{invalid",
	'{"target":"ssh"}',
])("defaults to Local for %s", (raw) => {
	window.localStorage.setItem(EXECUTION_TARGET_STORAGE_KEY, raw);
	expect(readExecutionTargetFromWindow()).toBe("local");
});

it("remembers the execution target and keeps Cloud and Local models separate", () => {
	const local = {
		lastProvider: "openrouter",
		lastModelByProvider: { openrouter: "local-model" },
	};
	const cloud = {
		lastProvider: "cline",
		lastModelByProvider: { cline: "cloud-model" },
	};
	writeModelSelectionStorageToWindow(local);
	writeExecutionTargetToWindow("cloud");
	writeModelSelectionStorageToWindow(cloud, "cloud");
	expect(readExecutionTargetFromWindow()).toBe("cloud");
	expect(readModelSelectionStorageFromWindow()).toEqual(local);
	expect(readModelSelectionStorageFromWindow("cloud")).toEqual(cloud);
	writeExecutionTargetToWindow("local");
	writeModelSelectionStorageToWindow(local);
	expect(readExecutionTargetFromWindow()).toBe("local");
	expect(readModelSelectionStorageFromWindow("cloud")).toEqual(cloud);
});
