import { describe, expect, it } from "vitest";
import {
	localDefaultsWithOllama,
	seedFacetsForProfile,
} from "@cline/drive";
import { BUILTIN_WEB_SPEECH_STT_ID } from "@cline/shared";
import {
	listDriveSettingsProviders,
	summarizeProfileSeed,
} from "./driveSettingsModel";

describe("listDriveSettingsProviders", () => {
	it("disables webSpeech under local profile", () => {
		const { facets, llm } = localDefaultsWithOllama();
		const options = listDriveSettingsProviders({
			facets,
			llm,
			slot: "stt",
		});
		const webSpeech = options.find(
			(option) => option.id === BUILTIN_WEB_SPEECH_STT_ID,
		);
		expect(webSpeech?.selectable).toBe(false);
		expect(
			options.find((option) => option.id === "builtin.localWorkerStt")
				?.selectable,
		).toBe(true);
	});
});

describe("summarizeProfileSeed", () => {
	it("formats local seed", () => {
		expect(summarizeProfileSeed(seedFacetsForProfile("local"))).toContain(
			"local",
		);
	});
});
