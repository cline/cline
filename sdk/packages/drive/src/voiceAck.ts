/**
 * Cheap ack narration for local (slow TTFT) voice turns.
 * Pure: no IO. Templates only — optional tiny-model ack can replace later.
 */

export type VoiceAckInput = {
	readonly profile: "local" | "cloud" | "hybrid";
	readonly utterance: string;
	readonly partnerName?: string;
};

export type VoiceAckResult = {
	readonly text: string;
	readonly usedTemplate: true;
};

export function buildVoiceAckNarration(input: VoiceAckInput): VoiceAckResult {
	const name = input.partnerName?.trim() || "Partner";
	const gist = summarizeUtterance(input.utterance);

	if (input.profile === "local") {
		return {
			usedTemplate: true,
			text: gist
				? `${name} here — got it: ${gist}. Working on that now.`
				: `${name} here — on it.`,
		};
	}

	return {
		usedTemplate: true,
		text: gist
			? `Got it: ${gist}.`
			: `Got it.`,
	};
}

function summarizeUtterance(utterance: string): string {
	const cleaned = utterance.replace(/\s+/g, " ").trim();
	if (!cleaned) {
		return "";
	}
	const max = 80;
	if (cleaned.length <= max) {
		return cleaned;
	}
	return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}
