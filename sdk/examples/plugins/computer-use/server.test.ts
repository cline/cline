import { describe, expect, test } from "bun:test";
import {
	callTool,
	claimSnapshot,
	DEFAULT_POST_ACTION_SETTLE_MS,
	DEFAULT_SNAPSHOT_TTL_MS,
	describeEnvironment,
	fitScreenshotDimensions,
	interpolatePointerPath,
	invalidateSnapshotsForDisplay,
	MAX_POST_ACTION_SETTLE_MS,
	MAX_SCREENSHOT_EDGE_PX,
	MAX_SCREENSHOT_PIXELS,
	MAX_SNAPSHOT_TTL_MS,
	MIN_SNAPSHOT_TTL_MS,
	movePointer,
	POST_ACTION_SETTLE_ENV_VAR,
	parsePngDimensions,
	resolvePostActionSettleMs,
	resolveSnapshotTtlMs,
	SNAPSHOT_TTL_ENV_VAR,
	SNAPSHOT_TTL_MS,
	sameDisplayGeometry,
	screenshotPointToDesktop,
	validateSnapshot,
} from "./server.mjs";

function pngWithDimensions(width: number, height: number): Buffer {
	const png = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(png);
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	return png;
}

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

describe("portable computer-use post-action settling", () => {
	test("uses the plugin-wide environment variable name and a short default", () => {
		expect(POST_ACTION_SETTLE_ENV_VAR).toBe(
			"CLINE_COMPUTER_USE_POST_ACTION_SETTLE_MS",
		);
		expect(DEFAULT_POST_ACTION_SETTLE_MS).toBe(500);
	});

	test("accepts, disables, and clamps environment overrides", () => {
		expect(resolvePostActionSettleMs("750")).toBe(750);
		expect(resolvePostActionSettleMs("0")).toBe(0);
		expect(resolvePostActionSettleMs("999999")).toBe(MAX_POST_ACTION_SETTLE_MS);
		expect(resolvePostActionSettleMs("invalid")).toBe(
			DEFAULT_POST_ACTION_SETTLE_MS,
		);
	});
});

describe("portable computer-use screenshot sizing", () => {
	test("preserves screenshots already inside the model-safe budget", () => {
		expect(fitScreenshotDimensions(1280, 720)).toEqual({
			width: 1280,
			height: 720,
		});
	});

	test("downscales Retina captures by both edge and pixel limits", () => {
		const fitted = fitScreenshotDimensions(4112, 2658);

		expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(
			MAX_SCREENSHOT_EDGE_PX,
		);
		expect(fitted.width * fitted.height).toBeLessThanOrEqual(
			MAX_SCREENSHOT_PIXELS,
		);
		expect(fitted.width / fitted.height).toBeCloseTo(4112 / 2658, 2);
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
	const png = pngWithDimensions(1920, 1080);

	expect(parsePngDimensions(png)).toEqual({ width: 1920, height: 1080 });
});

describe("portable computer-use tool transaction", () => {
	test("captures, consumes once, acts, settles, and returns a resized capture", async () => {
		const screenshotStore = new Map();
		const captureStore = new Map();
		const waits: number[] = [];
		const robotCalls: unknown[][] = [];
		let captures = 0;
		let ids = 0;
		const monitor = {
			id: () => 7,
			name: () => "Retina",
			x: () => 100,
			y: () => 50,
			width: () => 2056,
			height: () => 1329,
			scaleFactor: () => 2,
			rotation: () => 0,
			frequency: () => 60,
			isPrimary: () => true,
			captureImage: async () => {
				captures += 1;
				return { toPng: async () => pngWithDimensions(4112, 2658) };
			},
		};
		const runtime = {
			captureStore,
			snapshotStore: screenshotStore,
			loadScreenshots: async () => ({ Monitor: { all: () => [monitor] } }),
			loadRobot: async () => ({
				moveMouse: (x: number, y: number) => robotCalls.push(["move", x, y]),
				mouseClick: (button: string, double: boolean) =>
					robotCalls.push(["click", button, double]),
			}),
			resizeScreenshot: async (
				_png: Buffer,
				dimensions: { width: number; height: number },
			) => pngWithDimensions(dimensions.width, dimensions.height),
			now: () => 1_000,
			randomUUID: () => `snapshot-${++ids}`,
			wait: async (milliseconds: number) => {
				waits.push(milliseconds);
			},
			snapshotTtlMs: 60_000,
			postActionSettleMs: 350,
		};

		const observed = await callTool("computer_screenshot", {}, runtime);
		const observation = JSON.parse(observed.content[0]?.text ?? "{}");
		expect(observation.snapshot_id).toBe("snapshot-1");
		expect(observation.capture.pixel_width).toBeLessThan(4112);
		expect(captures).toBe(1);

		const action = await callTool(
			"computer_click",
			{
				snapshot_id: observation.snapshot_id,
				x: Math.floor(observation.capture.pixel_width / 2),
				y: Math.floor(observation.capture.pixel_height / 2),
			},
			runtime,
		);
		const actionResult = JSON.parse(action.content[0]?.text ?? "{}");
		expect(robotCalls[0]?.[0]).toBe("move");
		expect(robotCalls[1]).toEqual(["click", "left", false]);
		expect(waits).toEqual([350]);
		expect(captures).toBe(2);
		expect(actionResult.consumed_snapshot_id).toBe("snapshot-1");
		expect(actionResult.snapshot_id).toBe("snapshot-2");
		expect(screenshotStore.has("snapshot-1")).toBe(false);
		expect(screenshotStore.has("snapshot-2")).toBe(true);

		await expect(
			callTool(
				"computer_click",
				{ snapshot_id: "snapshot-1", x: 1, y: 1 },
				runtime,
			),
		).rejects.toThrow("already-consumed snapshot");
	});
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
