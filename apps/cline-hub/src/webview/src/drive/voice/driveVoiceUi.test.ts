import { describe, expect, it } from "vitest";
import {
	applyHardwarePrefsPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	resolveDriveVoiceTopology,
	shouldSpeakDriveTts,
} from "./driveVoiceUi";

describe("driveVoiceUi", () => {
	it("defaults to cloud pack with webSpeech forceMode", () => {
		const voice = createDefaultDriveVoiceUi("cloud");
		expect(voice.hardware).toEqual({
			micDeviceId: undefined,
			speakerDeviceId: undefined,
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

	it("shouldSpeakDriveTts defaults off and respects mute gates", () => {
		const voice = createDefaultDriveVoiceUi("cloud");
		expect(
			shouldSpeakDriveTts({
				facets: voice.facets,
				muted: false,
				partnerMuted: false,
			}),
		).toBe(false);

		const enabled = {
			...voice.facets,
			"tts.enabled": true,
		};
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				muted: false,
				partnerMuted: false,
			}),
		).toBe(true);
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				muted: true,
				partnerMuted: false,
			}),
		).toBe(false);
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				muted: false,
				partnerMuted: true,
			}),
		).toBe(false);
	});

	it("preserves hardware prefs across profile switches", () => {
		const withMic = applyHardwarePrefsPatch(
			createDefaultDriveVoiceUi("cloud"),
			{
				micDeviceId: "mic-a",
				speakerDeviceId: "spk-b",
				outputVolume: 0.4,
			},
		);
		const local = applyVoiceProfile(withMic, "local");
		expect(local.hardware).toEqual({
			micDeviceId: "mic-a",
			speakerDeviceId: "spk-b",
			outputVolume: 0.4,
		});
	});
});
