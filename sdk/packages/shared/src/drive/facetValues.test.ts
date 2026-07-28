import { describe, expect, it } from "vitest";
import { parseDriveFacetValues } from "./facetValues";

describe("parseDriveFacetValues", () => {
	it("parses a cloud seed shape", () => {
		const values = parseDriveFacetValues({
			"runtime.profile": "cloud",
			"runtime.egressCeiling": "platform-cloud",
			"providers.sttId": "builtin.webSpeech",
			"providers.sttConfig": {},
			"providers.ttsId": "builtin.browserTts",
			"providers.ttsConfig": {},
			"tts.enabled": false,
			"tts.maxSpokenSentences": 3,
			"captions.enabled": true,
			"drive.defaults.pairAgent": { kind: "builtin", id: "pair_partner" },
		});
		expect(values["runtime.profile"]).toBe("cloud");
	});

	it("rejects apiKey in provider config", () => {
		expect(() =>
			parseDriveFacetValues({
				"runtime.profile": "local",
				"runtime.egressCeiling": "loopback-only",
				"providers.sttId": "builtin.localWorkerStt",
				"providers.sttConfig": { apiKey: "nope" },
				"providers.ttsId": "builtin.browserTts",
				"providers.ttsConfig": {},
				"tts.enabled": false,
				"tts.maxSpokenSentences": 3,
				"captions.enabled": true,
				"drive.defaults.pairAgent": {
					kind: "builtin",
					id: "pair_partner",
				},
			}),
		).toThrow(/apiKey/);
	});
});
