/** Normalize spotlight / roster id checks for Drive MVP participants. */

import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

export function isDriveHumanId(id: string | null | undefined): boolean {
	return id === DRIVE_PARTICIPANT_HUMAN || id === "human";
}

export function isDrivePartnerId(id: string | null | undefined): boolean {
	return id === DRIVE_PARTICIPANT_PARTNER || id === "partner";
}

export function toggleDriveSpotlightId(current: string): string {
	return isDrivePartnerId(current)
		? DRIVE_PARTICIPANT_HUMAN
		: DRIVE_PARTICIPANT_PARTNER;
}
