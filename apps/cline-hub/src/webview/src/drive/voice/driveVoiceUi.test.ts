import { describe, expect, it } from "vitest";
import {
	applyHardwarePrefsPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	resolveDriveVoiceTopology,
} from "./driveVoiceUi";

describe("driveVoiceUi", () => {
	it("defaults to cloud pack with webSpeech forceMode", () => {
		const voice = createDefaultDriveVoiceUi("cloud");
		expect(voice.hardware).toEqual({
			micDeviceId: undefined,
			outputVolume: 1,
		});
		const resolved = resolveDriveVoiceTopology({
			voice,
			providerId: "anthropic",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.forceMode).toBe("speech-recognition");
	});

	it("local pack forces media-recorder", () => {
		const voice = applyVoiceProfile(
			createDefaultDriveVoiceUi("cloud"),
			"local",
		);
		const resolved = resolveDriveVoiceTopology({
			voice,
			providerId: "ollama",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.forceMode).toBe("media-recorder");
		expect(resolved.topology.stt.kind).toBe("local-worker");
	});

	it("preserves hardware prefs across profile switches", () => {
		const withMic = applyHardwarePrefsPatch(
			createDefaultDriveVoiceUi("cloud"),
			{ micDeviceId: "mic-a", outputVolume: 0.4 },
		);
		const local = applyVoiceProfile(withMic, "local");
		expect(local.hardware).toEqual({
			micDeviceId: "mic-a",
			outputVolume: 0.4,
		});
	});
});
