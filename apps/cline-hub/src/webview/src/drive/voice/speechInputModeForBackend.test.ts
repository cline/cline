import { describe, expect, it } from "vitest";
import { speechInputModeForBackend } from "./speechInputModeForBackend";

describe("speechInputModeForBackend", () => {
	it("uses Web Speech only for webSpeech backend", () => {
		expect(speechInputModeForBackend({ kind: "webSpeech" })).toBe(
			"speech-recognition",
		);
	});

	it("forces MediaRecorder for local-worker", () => {
		expect(
			speechInputModeForBackend({
				kind: "local-worker",
				engine: "whisper-cpp",
			}),
		).toBe("media-recorder");
	});

	it("uses MediaRecorder for cloud-api STT blobs", () => {
		expect(
			speechInputModeForBackend({
				kind: "cloud-api",
				engine: "openai-whisper",
			}),
		).toBe("media-recorder");
	});
});
