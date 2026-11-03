// @vitest-environment jsdom

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { beforeEach, expect, it } from "vitest";
import {
	getInitialChatConfig,
	getInitialCloudModel,
} from "@/hooks/chat-session/constants";
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

it.each([
	["cline", "openai/gpt-test", "openai/gpt-test"],
	["cline-pass", "cline-pass/pass-test", "cline-pass/pass-test"],
	["cline-pass", "cline-free/free-test", "cline-free/free-test"],
	["openrouter", "openai/gpt-test", CLINE_DEFAULT_MODEL_ID],
])("starts Cloud from the local %s model when nothing is remembered", (provider, model, expected) => {
	writeModelSelectionStorageToWindow({
		lastProvider: provider,
		lastModelByProvider: { [provider]: model },
	});
	expect(
		getInitialChatConfig("local", { executionTarget: "cloud" }),
	).toMatchObject({ provider: "cline", model: expected });
	writeModelSelectionStorageToWindow(
		{ lastProvider: "cline", lastModelByProvider: { cline: "cloud-model" } },
		"cloud",
	);
	expect(getInitialCloudModel(provider, model)).toBe("cloud-model");
});
