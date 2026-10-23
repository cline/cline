import { describe, expect, it } from "vitest";
import config from "../app.json";

describe("Android dictation permissions", () => {
	it("does not let image picker remove the microphone permission needed by dictation", () => {
		const picker = config.expo.plugins.find(
			(plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
		);
		const speech = config.expo.plugins.find(
			(plugin) =>
				Array.isArray(plugin) && plugin[0] === "expo-speech-recognition",
		);
		expect(picker).toBeDefined();
		expect(speech).toBeDefined();
		// expo-image-picker maps false to a manifest merger tools:node="remove"
		// rule, overriding RECORD_AUDIO even when speech recognition adds it.
		const options = Array.isArray(picker) ? picker[1] : undefined;
		expect(options).toMatchObject({
			microphonePermission:
				"Allow Cline to hear the coding request you dictate.",
		});
	});
});
