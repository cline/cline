import { describe, expect, test } from "bun:test";
import {
	claimSnapshot,
	DEFAULT_SNAPSHOT_TTL_MS,
	describeEnvironment,
	interpolatePointerPath,
	invalidateSnapshotsForDisplay,
	MAX_SNAPSHOT_TTL_MS,
	MIN_SNAPSHOT_TTL_MS,
	movePointer,
	parsePngDimensions,
	resolveSnapshotTtlMs,
	SNAPSHOT_TTL_ENV_VAR,
	SNAPSHOT_TTL_MS,
	sameDisplayGeometry,
	screenshotPointToDesktop,
	validateSnapshot,
} from "./server.mjs";

describe("portable computer-use snapshot TTL configuration", () => {
	test("uses the plugin-wide environment variable name", () => {
		expect(SNAPSHOT_TTL_ENV_VAR).toBe("CLINE_COMPUTER_USE_SNAPSHOT_TTL_MS");
	});

	test("defaults to 60 seconds", () => {
		expect(resolveSnapshotTtlMs(undefined)).toBe(60_000);
		expect(DEFAULT_SNAPSHOT_TTL_MS).toBe(60_000);
	});

	test("accepts and clamps environment overrides", () => {
		expect(resolveSnapshotTtlMs("30000")).toBe(30_000);
		expect(resolveSnapshotTtlMs("1000")).toBe(MIN_SNAPSHOT_TTL_MS);
		expect(resolveSnapshotTtlMs("999999")).toBe(MAX_SNAPSHOT_TTL_MS);
	});

	test("uses the default for invalid overrides", () => {
		expect(resolveSnapshotTtlMs("not-a-number")).toBe(DEFAULT_SNAPSHOT_TTL_MS);
		expect(resolveSnapshotTtlMs("")).toBe(DEFAULT_SNAPSHOT_TTL_MS);
	});
});

describe("portable computer-use coordinate mapping", () => {
	test("maps Retina screenshot pixels to logical desktop coordinates", () => {
		const display = {
			x: -1440,
			y: 0,
			width: 1440,
			height: 900,
			scale_factor: 2,
		};

		expect(screenshotPointToDesktop(display, { x: 1200, y: 800 })).toEqual({
			x: -840,
			y: 400,
		});
	});

	test("prefers measured capture scale", () => {
		const display = {
			x: 0,
			y: 0,
			width: 1280,
			height: 800,
			scale_factor: 1,
		};
		const capture = {
			pixel_width: 2560,
			pixel_height: 1600,
			scale_x: 2,
			scale_y: 2,
		};

		expect(
			screenshotPointToDesktop(display, { x: 2000, y: 1000 }, capture),
		).toEqual({ x: 1000, y: 500 });
	});

	test("rejects points outside the selected screenshot", () => {
		const display = {
			x: 0,
			y: 0,
			width: 100,
			height: 50,
			scale_factor: 1,
		};

		expect(() => screenshotPointToDesktop(display, { x: 100, y: 20 })).toThrow(
			"outside display screenshot bounds",
		);
	});

	test("keeps the final Retina pixel inside logical display bounds", () => {
		const display = {
			x: 100,
			y: 200,
			width: 100,
			height: 50,
			scale_factor: 2,
		};

		expect(screenshotPointToDesktop(display, { x: 199, y: 99 })).toEqual({
			x: 199,
			y: 249,
		});
	});
});

describe("portable computer-use environment detection", () => {
	test("marks a Wayland-only Linux session as degraded", () => {
		const environment = describeEnvironment("linux", {
			WAYLAND_DISPLAY: "wayland-0",
		});

		expect(environment.session_type).toBe("wayland");
		expect(environment.degraded).toBe(true);
	});

	test("accepts an X11 Linux session", () => {
		const environment = describeEnvironment("linux", {
			DISPLAY: ":1",
			XDG_SESSION_TYPE: "x11",
		});

		expect(environment.session_type).toBe("x11");
		expect(environment.degraded).toBe(false);
	});
});

test("reads PNG dimensions from the IHDR header", () => {
	const png = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(png);
	png.writeUInt32BE(1920, 16);
	png.writeUInt32BE(1080, 20);

	expect(parsePngDimensions(png)).toEqual({ width: 1920, height: 1080 });
});

describe("portable computer-use snapshot guards", () => {
	const display = {
		id: "main",
		x: 0,
		y: 0,
		width: 1440,
		height: 900,
		scale_factor: 2,
		rotation: 0,
	};
	const snapshot = {
		id: "snapshot-1",
		display,
		capture: {
			pixel_width: 2880,
			pixel_height: 1800,
			scale_x: 2,
			scale_y: 2,
		},
		created_at_ms: 1_000,
	};

	test("accepts a snapshot within the time limit", () => {
		expect(
			validateSnapshot(snapshot, { ...display }, 1_000 + SNAPSHOT_TTL_MS),
		).toBe(snapshot);
	});

	test("rejects an expired snapshot", () => {
		expect(() =>
			validateSnapshot(snapshot, { ...display }, 1_001 + SNAPSHOT_TTL_MS),
		).toThrow("expired");
	});

	test("rejects changed display geometry", () => {
		expect(sameDisplayGeometry(display, { ...display, width: 1280 })).toBe(
			false,
		);
		expect(() =>
			validateSnapshot(snapshot, { ...display, width: 1280 }, 2_000),
		).toThrow("Display geometry changed");
	});

	test("claims a snapshot synchronously and exactly once", () => {
		const store = new Map([[snapshot.id, snapshot]]);

		expect(claimSnapshot(store, snapshot.id)).toBe(snapshot);
		expect(() => claimSnapshot(store, snapshot.id)).toThrow(
			"already-consumed snapshot",
		);
	});

	test("invalidates older snapshots only on the same display", () => {
		const secondDisplaySnapshot = {
			...snapshot,
			id: "snapshot-2",
			display: { ...display, id: "secondary" },
		};
		const store = new Map([
			[snapshot.id, snapshot],
			[secondDisplaySnapshot.id, secondDisplaySnapshot],
		]);

		expect(invalidateSnapshotsForDisplay(store, display.id)).toBe(1);
		expect(store.has(snapshot.id)).toBe(false);
		expect(store.get(secondDisplaySnapshot.id)).toBe(secondDisplaySnapshot);
	});
});

describe("portable computer-use pointer movement", () => {
	test("interpolates signed coordinates and ends at the exact target", () => {
		const path = interpolatePointerPath(
			{ x: 100, y: 50 },
			{ x: -100, y: -50 },
			40,
		);

		expect(path.length).toBeGreaterThan(1);
		expect(path.at(-1)).toEqual({ x: -100, y: -50 });
		expect(path.some(({ x, y }) => x < 0 || y < 0)).toBe(true);
	});

	test("uses signed moveMouse steps instead of moveMouseSmooth", () => {
		const calls: Array<[string, number?, number?, string?]> = [];
		const robot = {
			updateScreenMetrics: () => calls.push(["metrics"]),
			getMousePos: () => ({ x: 50, y: 50 }),
			moveMouse: (x: number, y: number) => calls.push(["move", x, y]),
			dragMouse: (x: number, y: number, button?: string) =>
				calls.push(["drag", x, y, button]),
		};

		movePointer(robot, { x: -50, y: 100 }, true);

		expect(calls[0]).toEqual(["metrics"]);
		expect(calls.at(-1)).toEqual(["move", -50, 100]);
		expect(calls.some(([kind]) => kind === "drag")).toBe(false);
	});

	test("uses native drag events while interpolating a drag", () => {
		const calls: Array<[string, number?, number?, string?]> = [];
		const robot = {
			getMousePos: () => ({ x: -200, y: 0 }),
			moveMouse: (x: number, y: number) => calls.push(["move", x, y]),
			dragMouse: (x: number, y: number, button?: string) =>
				calls.push(["drag", x, y, button]),
		};

		movePointer(robot, { x: -100, y: 80 }, true, "left");

		expect(calls.at(-1)).toEqual(["drag", -100, 80, "left"]);
		expect(calls.every(([kind]) => kind === "drag")).toBe(true);
	});
});
