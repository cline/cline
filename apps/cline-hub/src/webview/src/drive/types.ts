/** Drive Layer UI state for hub Chat (wireframe A → B staging). */

import type { BankSnapshot } from "@cline/shared";
import {
	allowWorkspaceMutation,
	resolveDriveLoop,
	type DrivePostureOverride,
} from "@cline/drive";

export type DriveSubMode = "plan" | "agent" | "ask" | "debug";

/** Projection of hub stage.sharer for strip/Stage chrome. */
export type DriveStageSharerLocal = "agent" | "you";

export type DriveUiState = {
	active: boolean;
	/** Call Stage split layout (wireframe B). Off = Drive Layer only (A). */
	stageLayout: boolean;
	subMode: DriveSubMode;
	/** Explicit Ask/Debug override; null means bank-derived Plan/Agent. */
	postureOverride: DrivePostureOverride | null;
	partnerName: string;
	/** Human mic mute (DRV-MIC). */
	muted: boolean;
	handRaised: boolean;
	bankSnapshot: BankSnapshot;
	/**
	 * Spotlight owner participant id.
	 * Use {@link DRIVE_PARTICIPANT_HUMAN} / {@link DRIVE_PARTICIPANT_PARTNER} until
	 * full roster ids are wired from the hub.
	 */
	spotlightParticipantId: string;
	/** Partner agent cannot speak (TTS/narration). */
	partnerMuted: boolean;
	/** Partner agent cannot hear (inbound context). */
	partnerDeafened: boolean;
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

/** Stable ids until hub roster provides real participant UUIDs. */
export const DRIVE_PARTICIPANT_HUMAN = "drive:human";
export const DRIVE_PARTICIPANT_PARTNER = "drive:partner";

export const EMPTY_BANK_SNAPSHOT: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
};

export const DEFAULT_DRIVE_UI: DriveUiState = {
	active: false,
	stageLayout: false,
	subMode: "plan",
	postureOverride: null,
	partnerName: "Adam",
	muted: false,
	handRaised: false,
	bankSnapshot: EMPTY_BANK_SNAPSHOT,
	spotlightParticipantId: DRIVE_PARTICIPANT_PARTNER,
	partnerMuted: false,
	partnerDeafened: false,
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

/** Recompute Plan/Agent from bank unless Ask/Debug override is set. */
export function syncDrivePostureFromBank(state: DriveUiState): DriveUiState {
	if (!state.active) {
		return state;
	}
	const loop = resolveDriveLoop({
		driveActive: true,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return {
		...state,
		subMode: loop.posture,
	};
}

export function applyBankSnapshot(
	state: DriveUiState,
	snapshot: BankSnapshot,
): DriveUiState {
	return syncDrivePostureFromBank({ ...state, bankSnapshot: snapshot });
}

export function applySubModeIntent(
	state: DriveUiState,
	subMode: DriveSubMode,
): DriveUiState {
	if (!state.active) {
		return state;
	}
	if (subMode === "ask" || subMode === "debug") {
		return {
			...state,
			postureOverride: subMode,
			subMode,
		};
	}
	// Plan/Agent while override is set: ignore (override clears only explicitly).
	if (state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, subMode });
}

export function clearPostureOverride(state: DriveUiState): DriveUiState {
	if (!state.active || !state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, postureOverride: null });
}

export function canMutateWorkspace(state: DriveUiState): boolean {
	const loop = resolveDriveLoop({
		driveActive: state.active,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return allowWorkspaceMutation(loop).allowed;
}

export function drivePersonaSystemHint(state: DriveUiState): string {
	if (!state.active) {
		return "";
	}
	const bound = state.bankSnapshot.nowTaskId;
	return [
		"You are in Cline Drive mode: a senior engineer pair-programming on a call.",
		`Partner name: ${state.partnerName}.`,
		`Drive sub-mode: ${state.subMode} (maps to native ${toNativeMode(state.subMode)}).`,
		state.postureOverride
			? `Posture override active: ${state.postureOverride} (clear explicitly to return to bank-derived posture).`
			: "Posture is derived from the task bank (Plan when empty, Agent when open tasks exist).",
		bound
			? `Bound DriveTask: ${bound}${state.bankSnapshot.nowTitle ? ` (${state.bankSnapshot.nowTitle})` : ""}.`
			: "No open DriveTask. Prefer Plan posture: author plan + task files under .drive/bank/.",
		"Narrate decisions briefly and transparently, like a colleague sharing their screen.",
		"Prefer short spoken-style explanations before and after meaningful tool work.",
		"Do not invent a parallel chat participant. Work in this session.",
	].join(" ");
}
