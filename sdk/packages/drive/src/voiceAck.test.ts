import { describe, expect, it } from "vitest";
import { buildVoiceAckNarration } from "./voiceAck.js";

describe("buildVoiceAckNarration", () => {
	it("builds a local ack with gist", () => {
		const ack = buildVoiceAckNarration({
			profile: "local",
			partnerName: "Ada",
			utterance: "fix the flaky auth test",
		});
		expect(ack.text).toContain("Ada");
		expect(ack.text).toContain("fix the flaky auth test");
		expect(ack.usedTemplate).toBe(true);
	});

	it("truncates long utterances", () => {
		const long = "x".repeat(120);
		const ack = buildVoiceAckNarration({
			profile: "cloud",
			utterance: long,
		});
		expect(ack.text.length).toBeLessThan(long.length + 20);
		expect(ack.text).toContain("…");
	});
});
