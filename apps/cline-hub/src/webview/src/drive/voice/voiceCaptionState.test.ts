import { describe, expect, it } from "vitest";
import {
	buildDrivePersistPayload,
	clearVoiceCaptionAfterSend,
	clearVoiceCaptionDraft,
	persistPayloadHasCaptionKeys,
} from "./voiceCaptionState";

describe("voiceCaptionState", () => {
	it("clears caption residue after discard", () => {
		expect(clearVoiceCaptionDraft()).toBe("");
	});

	it("clears caption residue after send", () => {
		expect(clearVoiceCaptionAfterSend()).toBe("");
	});

	it("persist payload includes only driveUi/driveVoice and strips caption keys", () => {
		const payload = buildDrivePersistPayload({
			existing: {
				modelSelection: { lastProvider: "anthropic" },
				voiceCaption: "should not persist",
				caption: "nope",
				transcript: "nope",
			},
			driveUi: { active: true },
			driveVoice: { profile: "cloud", facets: {}, settingsOpen: false },
		});
		expect(payload.driveUi).toEqual({ active: true });
		expect(payload.driveVoice).toMatchObject({ profile: "cloud" });
		expect(payload.modelSelection).toEqual({ lastProvider: "anthropic" });
		expect(persistPayloadHasCaptionKeys(payload)).toBe(false);
		expect(payload).not.toHaveProperty("voiceCaption");
		expect(payload).not.toHaveProperty("caption");
		expect(payload).not.toHaveProperty("transcript");
	});
});
