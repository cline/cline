/** Pure helpers for Drive roster + participant sheet (DRV-ROSTER / DRV-PARTICIPANT-SHEET). */

import type { Participant } from "@cline/shared";
import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
} from "./types";

/**
 * Hub-projected participants, or a synthetic human + pair_partner when the
 * snapshot has not arrived yet (demo / pre-join chrome).
 */
export function resolveRosterParticipants(
	drive: DriveUiState,
): Participant[] {
	if (drive.participants.length > 0) {
		return drive.participants;
	}
	return [
		{
			id: DRIVE_PARTICIPANT_HUMAN,
			kind: "human",
			displayName: "You",
			role: "host",
			status: "idle",
		},
		{
			id: DRIVE_PARTICIPANT_PARTNER,
			kind: "agent",
			displayName: drive.partnerName,
			role: "partner",
			status: "idle",
			seatSources: [],
		},
	];
}

/**
 * Resolve `.driveagent/<slug>/` for an agent participant.
 * Builtin pair_partner / default partner maps to the example fixture slug.
 * seatSources may carry a driveagent slug when packs seat a home.
 */
export function resolveAgentHomeSlug(
	participant: Participant,
): string | null {
	if (participant.kind !== "agent") {
		return null;
	}
	for (const source of participant.seatSources) {
		const trimmed = source.trim();
		if (/^[a-z0-9-]+$/.test(trimmed)) {
			return trimmed;
		}
	}
	if (
		participant.role === "partner" ||
		participant.id === DRIVE_PARTICIPANT_PARTNER ||
		participant.id === "adam"
	) {
		return "pair-partner";
	}
	return null;
}

/** Mute badge from Drive chrome flags (MVP: human mic + partner mute). */
export function isRosterParticipantMuted(
	drive: DriveUiState,
	participant: Participant,
): boolean {
	switch (participant.kind) {
		case "human":
			return drive.muted;
		case "agent":
			return drive.partnerMuted;
		default: {
			const _exhaustive: never = participant;
			return _exhaustive;
		}
	}
}

export function isRosterParticipantHandRaised(
	drive: DriveUiState,
	participant: Participant,
): boolean {
	switch (participant.kind) {
		case "human":
			return drive.handRaised;
		case "agent":
			return false;
		default: {
			const _exhaustive: never = participant;
			return _exhaustive;
		}
	}
}

/**
 * Transcript intent: focus that participant's stream and apply address-follows-focus
 * (agent → address them; human/self → everyone / cleared).
 */
export function applyTranscriptFocus(
	state: DriveUiState,
	participantId: string,
): DriveUiState {
	const participant = resolveRosterParticipants(state).find(
		(entry) => entry.id === participantId,
	);
	const addressFollowsFocusParticipantId =
		participant?.kind === "agent" ? participantId : null;
	return {
		...state,
		focusedParticipantId: participantId,
		addressFollowsFocusParticipantId,
	};
}

export function participantStatusLabel(
	status: Participant["status"],
): string {
	switch (status) {
		case "idle":
			return "idle";
		case "working":
			return "thinking";
		case "speaking":
			return "speaking";
		case "away":
			return "away";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}
