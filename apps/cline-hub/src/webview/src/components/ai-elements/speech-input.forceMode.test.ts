import { describe, expect, it } from "vitest";
import { speechInputModeForBackend } from "../../drive/voice/speechInputModeForBackend";

describe("SpeechInput forceMode contract", () => {
	it("local-worker maps to media-recorder for forceMode", () => {
		expect(
			speechInputModeForBackend({
				kind: "local-worker",
				engine: "whisper-cpp",
			}),
		).toBe("media-recorder");
	});
});
