import type { SttBackend } from "@cline/shared";

export type SpeechInputMode = "speech-recognition" | "media-recorder" | "none";

/**
 * Map topology STT backend to SpeechInput capture mode.
 * Local worker always uses MediaRecorder (never Web Speech).
 */
export function speechInputModeForBackend(
	backend: SttBackend,
): SpeechInputMode {
	switch (backend.kind) {
		case "webSpeech":
			return "speech-recognition";
		case "local-worker":
		case "cloud-api":
			return "media-recorder";
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}
