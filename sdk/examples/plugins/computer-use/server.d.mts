export interface DisplayGeometry {
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	scale_factor?: number;
	scaleFactor?: number;
	rotation?: number;
}

export interface CaptureGeometry {
	pixel_width: number;
	pixel_height: number;
	scale_x: number;
	scale_y: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Snapshot {
	id: string;
	display: DisplayGeometry;
	capture: CaptureGeometry;
	created_at_ms: number;
}

export interface PointerRobot {
	updateScreenMetrics?: () => void;
	getMousePos: () => Point;
	moveMouse: (x: number, y: number) => void;
	dragMouse: (x: number, y: number, button?: string) => void;
}

export const DEFAULT_SNAPSHOT_TTL_MS: number;
export const MIN_SNAPSHOT_TTL_MS: number;
export const MAX_SNAPSHOT_TTL_MS: number;
export const SNAPSHOT_TTL_ENV_VAR: string;
export const SNAPSHOT_TTL_MS: number;

export function resolveSnapshotTtlMs(value: string | undefined): number;

export function describeEnvironment(
	platform?: string,
	env?: Record<string, string | undefined>,
): {
	platform: string;
	supported_platform: boolean;
	session_type: string | undefined;
	display: string | undefined;
	wayland_display: string | undefined;
	input_backend: string;
	screenshot_backend: string;
	degraded: boolean;
	notes: string[];
};

export function parsePngDimensions(png: Buffer): {
	width: number;
	height: number;
};

export function screenshotPointToDesktop(
	display: DisplayGeometry,
	point: Point,
	capture?: CaptureGeometry,
): Point;

export function invalidateSnapshotsForDisplay(
	snapshotStore: Map<string, Snapshot>,
	displayId: string,
): number;

export function claimSnapshot(
	snapshotStore: Map<string, Snapshot>,
	snapshotId: string,
): Snapshot;

export function interpolatePointerPath(
	start: Point,
	end: Point,
	maximumStep?: number,
): Point[];

export function movePointer(
	robot: PointerRobot,
	point: Point,
	smooth?: boolean,
	dragButton?: string,
): void;

export function sameDisplayGeometry(
	left: DisplayGeometry,
	right: DisplayGeometry,
): boolean;

export function validateSnapshot(
	snapshot: Snapshot,
	currentDisplay: DisplayGeometry,
	now?: number,
	ttl?: number,
): Snapshot;

export function main(): Promise<void>;
