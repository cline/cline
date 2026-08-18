export const AVATAR_CELL_WIDTH = 192;
export const AVATAR_CELL_HEIGHT = 208;
export const AVATAR_ATLAS_COLUMNS = 8;
export const AVATAR_ATLAS_ROWS = 11;
export const AVATAR_DISPLAY_SCALE = 0.75;

export const AVATAR_IDLE_DURATIONS_MS = [280, 110, 110, 140, 140, 320] as const;
export const AVATAR_WAVE_DURATIONS_MS = [140, 140, 140, 280] as const;
export const AVATAR_JUMP_DURATIONS_MS = [140, 140, 140, 140, 280] as const;

export function avatarFrameBackgroundPosition(
	row: number,
	column: number,
	scale = 1,
): string {
	if (!Number.isInteger(row) || row < 0 || row >= AVATAR_ATLAS_ROWS) {
		throw new RangeError(`avatar row must be between 0 and ${AVATAR_ATLAS_ROWS - 1}`);
	}
	if (!Number.isInteger(column) || column < 0 || column >= AVATAR_ATLAS_COLUMNS) {
		throw new RangeError(
			`avatar column must be between 0 and ${AVATAR_ATLAS_COLUMNS - 1}`,
		);
	}
	if (!Number.isFinite(scale) || scale <= 0) {
		throw new RangeError("avatar scale must be greater than zero");
	}
	return `${-column * AVATAR_CELL_WIDTH * scale}px ${-row * AVATAR_CELL_HEIGHT * scale}px`;
}
