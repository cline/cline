import type { ParticipantAudioFlags } from "@cline/shared";

export type SpotlightReject =
	| { ok: true; spotlightParticipantId: string }
	| { ok: false; code: string; message: string };

export function setSpotlight(input: {
	participantId: string;
	seatedIds: ReadonlySet<string>;
}): SpotlightReject {
	if (!input.seatedIds.has(input.participantId)) {
		return {
			ok: false,
			code: "unknown_participant",
			message: `Cannot spotlight ${input.participantId}: not seated.`,
		};
	}
	return { ok: true, spotlightParticipantId: input.participantId };
}

export function setParticipantMuted(
	flags: readonly ParticipantAudioFlags[],
	participantId: string,
	muted: boolean,
): ParticipantAudioFlags[] {
	return upsertFlag(flags, participantId, { muted });
}

export function setParticipantDeafened(
	flags: readonly ParticipantAudioFlags[],
	participantId: string,
	deafened: boolean,
): ParticipantAudioFlags[] {
	return upsertFlag(flags, participantId, { deafened });
}

function upsertFlag(
	flags: readonly ParticipantAudioFlags[],
	participantId: string,
	patch: Partial<Pick<ParticipantAudioFlags, "muted" | "deafened">>,
): ParticipantAudioFlags[] {
	const existing = flags.find((flag) => flag.participantId === participantId);
	if (!existing) {
		return [
			...flags,
			{
				participantId,
				muted: patch.muted ?? false,
				deafened: patch.deafened ?? false,
			},
		];
	}
	return flags.map((flag) =>
		flag.participantId === participantId
			? {
					...flag,
					muted: patch.muted ?? flag.muted,
					deafened: patch.deafened ?? flag.deafened,
				}
			: flag,
	);
}
