/**
 * Drive mode state machine (DRV-KERNEL).
 * Pure: no IO. Illegal transitions throw typed errors.
 */

import type { DriveSubMode } from "@cline/shared";

export type DriveModeState = {
	readonly active: boolean;
	readonly subMode: DriveSubMode;
};

export type DriveModeAction =
	| { type: "activate"; subMode?: DriveSubMode }
	| { type: "deactivate" }
	| { type: "setSubMode"; subMode: DriveSubMode };

export class IllegalDriveModeTransitionError extends Error {
	readonly code = "illegal_drive_mode_transition" as const;

	constructor(
		readonly from: DriveModeState,
		readonly action: DriveModeAction,
		message: string,
	) {
		super(message);
		this.name = "IllegalDriveModeTransitionError";
	}
}

export const DEFAULT_DRIVE_MODE: DriveModeState = {
	active: false,
	subMode: "plan",
};

export function transitionDriveMode(
	state: DriveModeState,
	action: DriveModeAction,
): DriveModeState {
	switch (action.type) {
		case "activate":
			return {
				active: true,
				subMode: action.subMode ?? state.subMode,
			};
		case "deactivate":
			return {
				active: false,
				subMode: state.subMode,
			};
		case "setSubMode": {
			if (!state.active) {
				throw new IllegalDriveModeTransitionError(
					state,
					action,
					"Cannot set Drive sub-mode while Drive is inactive",
				);
			}
			return {
				active: true,
				subMode: action.subMode,
			};
		}
		default: {
			const _exhaustive: never = action;
			throw new IllegalDriveModeTransitionError(
				state,
				_exhaustive,
				"Unknown Drive mode action",
			);
		}
	}
}
