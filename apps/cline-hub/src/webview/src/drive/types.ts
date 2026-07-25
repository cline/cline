/** Drive Layer UI state for hub Chat (wireframe A → B staging). */

export type DriveSubMode = "plan" | "agent" | "ask" | "debug";

/** Projection of hub stage.sharer for strip/Stage chrome. */
export type DriveStageSharerLocal = "agent" | "you";

export type DriveUiState = {
	active: boolean;
	/** Call Stage split layout (wireframe B). Off = Drive Layer only (A). */
	stageLayout: boolean;
	subMode: DriveSubMode;
	partnerName: string;
	muted: boolean;
	handRaised: boolean;
	/**
	 * Offline fixture cards when demo and no live session tools yet.
	 * Room ownership still goes through hub call_* when connected.
	 */
	demo: boolean;
	/**
	 * Mirror of hub room stage.sharer (agent|you). Updated from room_snapshot.
	 * Authority is hub call_set_stage — not this field alone.
	 */
	stageSharer: DriveStageSharerLocal;
	/** Hub room id when Join has attached a call. */
	roomId: string | null;
};

export const DEFAULT_DRIVE_UI: DriveUiState = {
	active: false,
	stageLayout: false,
	subMode: "agent",
	partnerName: "Adam",
	muted: false,
	handRaised: false,
	demo: true,
	stageSharer: "agent",
	roomId: null,
};

/** Map Drive sub-mode onto native Cline plan|act for send config. */
export function toNativeMode(subMode: DriveSubMode): "act" | "plan" {
	switch (subMode) {
		case "plan":
		case "ask":
			return "plan";
		case "agent":
		case "debug":
			return "act";
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

/** Map UI sub-mode onto shared DriveSubMode for call_set_mode. */
export function toSharedDriveSubMode(
	subMode: DriveSubMode,
): "plan" | "act" | "ask" | "debug" {
	switch (subMode) {
		case "agent":
			return "act";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

export function fromSharedDriveSubMode(
	subMode: "plan" | "act" | "ask" | "debug",
): DriveSubMode {
	switch (subMode) {
		case "act":
			return "agent";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

export function drivePersonaSystemHint(state: DriveUiState): string {
	if (!state.active) {
		return "";
	}
	return [
		"You are in Cline Drive mode: a senior engineer pair-programming on a call.",
		`Partner name: ${state.partnerName}.`,
		`Drive sub-mode: ${state.subMode} (maps to native ${toNativeMode(state.subMode)}).`,
		"Narrate decisions briefly and transparently, like a colleague sharing their screen.",
		"Prefer short spoken-style explanations before and after meaningful tool work.",
		"Do not invent a parallel chat participant. Work in this session.",
	].join(" ");
}
