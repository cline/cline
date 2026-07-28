#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "computer-use-portable-backend";
const SERVER_VERSION = "0.1.0";
const captureByDisplay = new Map();
const snapshots = new Map();
export const DEFAULT_SNAPSHOT_TTL_MS = 60_000;
export const MIN_SNAPSHOT_TTL_MS = 5_000;
export const MAX_SNAPSHOT_TTL_MS = 300_000;
export const SNAPSHOT_TTL_ENV_VAR = "CLINE_COMPUTER_USE_SNAPSHOT_TTL_MS";

export function resolveSnapshotTtlMs(value) {
	if (value === undefined || value.trim() === "") {
		return DEFAULT_SNAPSHOT_TTL_MS;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_SNAPSHOT_TTL_MS;
	}
	return Math.min(
		MAX_SNAPSHOT_TTL_MS,
		Math.max(MIN_SNAPSHOT_TTL_MS, Math.round(parsed)),
	);
}

export const SNAPSHOT_TTL_MS = resolveSnapshotTtlMs(
	process.env[SNAPSHOT_TTL_ENV_VAR],
);

const tools = [
	{
		name: "computer_environment",
		description:
			"Report the operating system, desktop session, display variables, and native backend availability. Call this before the first desktop action.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: "computer_list_displays",
		description:
			"List displays and their logical desktop bounds. The primary display is returned first.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: "computer_screenshot",
		description:
			"Capture one display as PNG and return a short-lived snapshot_id. Coordinates used by other computer tools are pixels relative to this image. Defaults to the primary display.",
		inputSchema: {
			type: "object",
			properties: {
				display_id: {
					type: "string",
					description:
						"Display ID from computer_list_displays. Omit for the primary display.",
				},
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: "computer_cursor_position",
		description:
			"Return the cursor position in global logical desktop coordinates and, when possible, selected-display screenshot pixels.",
		inputSchema: {
			type: "object",
			properties: {
				display_id: {
					type: "string",
					description:
						"Optional display used for screenshot-relative coordinates.",
				},
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: "computer_move",
		description:
			"Move the cursor using a fresh snapshot_id. x and y are pixels relative to that screenshot. Consumes the snapshot and returns a new screenshot.",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				x: { type: "number" },
				y: { type: "number" },
				smooth: {
					type: "boolean",
					description: "Animate the movement. Defaults to false.",
				},
			},
			required: ["snapshot_id", "x", "y"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: false },
	},
	{
		name: "computer_click",
		description:
			"Click at coordinates from a fresh snapshot_id. Consumes the snapshot and returns a new screenshot.",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				x: { type: "number" },
				y: { type: "number" },
				button: {
					type: "string",
					enum: ["left", "right", "middle"],
					default: "left",
				},
				clicks: {
					type: "integer",
					enum: [1, 2],
					default: 1,
				},
			},
			required: ["snapshot_id", "x", "y"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true },
	},
	{
		name: "computer_drag",
		description:
			"Drag between two points from a fresh snapshot_id. Consumes the snapshot and returns a new screenshot.",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				start_x: { type: "number" },
				start_y: { type: "number" },
				end_x: { type: "number" },
				end_y: { type: "number" },
				button: {
					type: "string",
					enum: ["left", "right", "middle"],
					default: "left",
				},
			},
			required: ["snapshot_id", "start_x", "start_y", "end_x", "end_y"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true },
	},
	{
		name: "computer_scroll",
		description:
			"Scroll at coordinates from a fresh snapshot_id. Positive delta_y scrolls up and negative delta_y scrolls down. Consumes the snapshot and returns a new screenshot.",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				x: { type: "number" },
				y: { type: "number" },
				delta_x: { type: "integer", default: 0 },
				delta_y: { type: "integer" },
			},
			required: ["snapshot_id", "x", "y", "delta_y"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true },
	},
	{
		name: "computer_type",
		description:
			"Type literal text at the current keyboard focus using a fresh snapshot_id. Consumes the snapshot and returns a new screenshot. Use computer_key for shortcuts and special keys.",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				text: { type: "string" },
			},
			required: ["snapshot_id", "text"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true },
	},
	{
		name: "computer_key",
		description:
			"Press one key with optional modifiers using a fresh snapshot_id. Consumes the snapshot and returns a new screenshot. Examples: key='enter'; key='c', modifiers=['control'].",
		inputSchema: {
			type: "object",
			properties: {
				snapshot_id: { type: "string" },
				key: { type: "string" },
				modifiers: {
					type: "array",
					items: {
						type: "string",
						enum: ["alt", "command", "control", "shift", "right_shift"],
					},
					default: [],
				},
			},
			required: ["snapshot_id", "key"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true },
	},
];

export function describeEnvironment(
	platform = process.platform,
	env = process.env,
) {
	const sessionType =
		env.XDG_SESSION_TYPE ||
		(env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : undefined);
	const waylandOnly =
		platform === "linux" && Boolean(env.WAYLAND_DISPLAY) && !env.DISPLAY;

	return {
		platform,
		supported_platform: ["darwin", "win32", "linux"].includes(platform),
		session_type: sessionType,
		display: env.DISPLAY,
		wayland_display: env.WAYLAND_DISPLAY,
		input_backend: "@jitsi/robotjs",
		screenshot_backend: "node-screenshots",
		degraded: waylandOnly,
		notes:
			platform === "darwin"
				? [
						"Grant Screen Recording and Accessibility to the process hosting Cline.",
					]
				: waylandOnly
					? [
							"Native Wayland capture and input are not available. Use an X11/XWayland session or a compositor-specific portal backend.",
						]
					: platform === "linux"
						? ["The portable backend requires an available X11 display."]
						: [],
	};
}

export function parsePngDimensions(png) {
	if (!Buffer.isBuffer(png) || png.length < 24) {
		throw new Error("Screenshot backend returned an invalid PNG.");
	}
	const signature = png.subarray(0, 8).toString("hex");
	if (signature !== "89504e470d0a1a0a") {
		throw new Error("Screenshot backend returned non-PNG image data.");
	}
	return {
		width: png.readUInt32BE(16),
		height: png.readUInt32BE(20),
	};
}

export function screenshotPointToDesktop(display, point, capture) {
	const scaleX =
		capture?.scale_x || display.scale_factor || display.scaleFactor || 1;
	const scaleY =
		capture?.scale_y || display.scale_factor || display.scaleFactor || 1;
	const pixelWidth = capture?.pixel_width || Math.round(display.width * scaleX);
	const pixelHeight =
		capture?.pixel_height || Math.round(display.height * scaleY);

	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < 0 ||
		point.y < 0 ||
		point.x >= pixelWidth ||
		point.y >= pixelHeight
	) {
		throw new Error(
			`Point (${point.x}, ${point.y}) is outside display screenshot bounds ${pixelWidth}x${pixelHeight}.`,
		);
	}

	return {
		x: display.x + Math.round(point.x / scaleX),
		y: display.y + Math.round(point.y / scaleY),
	};
}

export function sameDisplayGeometry(left, right) {
	return (
		left.id === right.id &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height &&
		left.scale_factor === right.scale_factor &&
		left.rotation === right.rotation
	);
}

export function validateSnapshot(
	snapshot,
	currentDisplay,
	now = Date.now(),
	ttl = SNAPSHOT_TTL_MS,
) {
	if (now - snapshot.created_at_ms > ttl) {
		throw new Error(
			`Snapshot '${snapshot.id}' expired. Take a new computer_screenshot before acting.`,
		);
	}
	if (!sameDisplayGeometry(snapshot.display, currentDisplay)) {
		throw new Error(
			`Display geometry changed after snapshot '${snapshot.id}'. Take a new computer_screenshot before acting.`,
		);
	}
	return snapshot;
}

async function loadRobot() {
	const imported = await import("@jitsi/robotjs");
	return imported.default ?? imported;
}

async function loadScreenshots() {
	const imported = await import("node-screenshots");
	const screenshots = imported.default ?? imported;
	if (!screenshots.Monitor) {
		throw new Error("node-screenshots did not expose its Monitor API.");
	}
	return screenshots;
}

function toDisplay(monitor) {
	return {
		id: String(monitor.id()),
		name: monitor.name(),
		x: monitor.x(),
		y: monitor.y(),
		width: monitor.width(),
		height: monitor.height(),
		scale_factor: monitor.scaleFactor(),
		rotation: monitor.rotation(),
		frequency: monitor.frequency(),
		primary: monitor.isPrimary(),
	};
}

async function getDisplayRecords() {
	const { Monitor } = await loadScreenshots();
	return Monitor.all()
		.map((monitor) => ({ monitor, display: toDisplay(monitor) }))
		.sort(
			(left, right) =>
				Number(right.display.primary) - Number(left.display.primary),
		);
}

async function selectDisplay(displayId) {
	const records = await getDisplayRecords();
	if (records.length === 0) {
		throw new Error("No displays are available to capture.");
	}
	if (displayId === undefined) {
		return records.find(({ display }) => display.primary) ?? records[0];
	}
	const record = records.find(({ display }) => display.id === displayId);
	if (!record) {
		throw new Error(
			`Unknown display_id '${displayId}'. Call computer_list_displays first.`,
		);
	}
	return record;
}

async function selectSnapshotDisplay(snapshot) {
	const records = await getDisplayRecords();
	const selected = records.find(
		({ display }) => display.id === snapshot.display.id,
	);
	if (!selected) {
		snapshots.delete(snapshot.id);
		throw new Error(
			`Snapshot '${snapshot.id}' display is no longer available. Take a new computer_screenshot before acting.`,
		);
	}
	return selected;
}

async function captureDisplay(selected) {
	const image = await selected.monitor.captureImage();
	const png = Buffer.from(await image.toPng());
	const dimensions = parsePngDimensions(png);
	const capture = {
		pixel_width: dimensions.width,
		pixel_height: dimensions.height,
		scale_x: dimensions.width / selected.display.width,
		scale_y: dimensions.height / selected.display.height,
	};
	const createdAt = Date.now();
	for (const [id, existing] of snapshots) {
		if (createdAt - existing.created_at_ms > SNAPSHOT_TTL_MS) {
			snapshots.delete(id);
		}
	}
	const snapshot = {
		id: randomUUID(),
		display: selected.display,
		capture,
		created_at_ms: createdAt,
	};
	captureByDisplay.set(selected.display.id, capture);
	snapshots.set(snapshot.id, snapshot);
	return { png, snapshot };
}

function asObject(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

function optionalString(args, key) {
	const value = args[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new Error(`${key} must be a string.`);
	}
	return value;
}

function requiredNumber(args, key) {
	const value = args[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${key} must be a finite number.`);
	}
	return value;
}

function requiredString(args, key) {
	const value = args[key];
	if (typeof value !== "string") {
		throw new Error(`${key} must be a string.`);
	}
	return value;
}

function textResult(value) {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
	};
}

function screenshotResult(snapshot, png, value = {}) {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						...value,
						snapshot_id: snapshot.id,
						snapshot_expires_in_ms: SNAPSHOT_TTL_MS,
						display: snapshot.display,
						capture: snapshot.capture,
						coordinate_space:
							"Screenshot pixels relative to this display. Pass this snapshot_id to exactly one mutating action.",
					},
					null,
					2,
				),
			},
			{
				type: "image",
				data: png.toString("base64"),
				mimeType: "image/png",
			},
		],
	};
}

function errorResult(error) {
	return {
		isError: true,
		content: [
			{
				type: "text",
				text:
					error instanceof Error
						? error.message
						: "Unknown portable computer-use error.",
			},
		],
	};
}

async function consumeSnapshot(args) {
	const snapshotId = requiredString(args, "snapshot_id");
	const snapshot = snapshots.get(snapshotId);
	if (!snapshot) {
		throw new Error(
			`Unknown or already-consumed snapshot '${snapshotId}'. Take a new computer_screenshot before acting.`,
		);
	}
	const selected = await selectSnapshotDisplay(snapshot);
	validateSnapshot(snapshot, selected.display);
	snapshots.delete(snapshotId);
	return { ...selected, snapshot };
}

function pointFromSnapshot(snapshot, args, xKey = "x", yKey = "y") {
	return screenshotPointToDesktop(
		snapshot.display,
		{
			x: requiredNumber(args, xKey),
			y: requiredNumber(args, yKey),
		},
		snapshot.capture,
	);
}

async function postActionResult(selected, consumedSnapshotId, value) {
	const { snapshot, png } = await captureDisplay(selected);
	return screenshotResult(snapshot, png, {
		...value,
		consumed_snapshot_id: consumedSnapshotId,
	});
}

async function callTool(name, rawArgs) {
	const args = asObject(rawArgs);

	switch (name) {
		case "computer_environment": {
			const environment = describeEnvironment();
			const availability = { input: true, screenshots: true };
			const errors = [];
			try {
				await loadRobot();
			} catch (error) {
				availability.input = false;
				errors.push(
					`Input backend: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			try {
				await loadScreenshots();
			} catch (error) {
				availability.screenshots = false;
				errors.push(
					`Screenshot backend: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return textResult({ ...environment, availability, errors });
		}
		case "computer_list_displays": {
			const records = await getDisplayRecords();
			return textResult({ displays: records.map(({ display }) => display) });
		}
		case "computer_screenshot": {
			const selected = await selectDisplay(optionalString(args, "display_id"));
			const { snapshot, png } = await captureDisplay(selected);
			return screenshotResult(snapshot, png);
		}
		case "computer_cursor_position": {
			const robot = await loadRobot();
			const position = robot.getMousePos();
			const selected = await selectDisplay(optionalString(args, "display_id"));
			const capture = captureByDisplay.get(selected.display.id);
			const scaleX = capture?.scale_x || selected.display.scale_factor || 1;
			const scaleY = capture?.scale_y || selected.display.scale_factor || 1;
			return textResult({
				global_logical: position,
				display_id: selected.display.id,
				screenshot_pixels: {
					x: Math.round((position.x - selected.display.x) * scaleX),
					y: Math.round((position.y - selected.display.y) * scaleY),
				},
			});
		}
		case "computer_move": {
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			const point = pointFromSnapshot(selected.snapshot, args);
			if (args.smooth === true) {
				robot.moveMouseSmooth(point.x, point.y);
			} else {
				robot.moveMouse(point.x, point.y);
			}
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				global_logical: point,
			});
		}
		case "computer_click": {
			const button = optionalString(args, "button") ?? "left";
			if (!["left", "right", "middle"].includes(button)) {
				throw new Error("button must be left, right, or middle.");
			}
			const clicks = args.clicks ?? 1;
			if (clicks !== 1 && clicks !== 2) {
				throw new Error("clicks must be 1 or 2.");
			}
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			const point = pointFromSnapshot(selected.snapshot, args);
			robot.moveMouse(point.x, point.y);
			robot.mouseClick(button, clicks === 2);
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				global_logical: point,
				button,
				clicks,
			});
		}
		case "computer_drag": {
			const button = optionalString(args, "button") ?? "left";
			if (!["left", "right", "middle"].includes(button)) {
				throw new Error("button must be left, right, or middle.");
			}
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			const start = pointFromSnapshot(
				selected.snapshot,
				args,
				"start_x",
				"start_y",
			);
			const end = pointFromSnapshot(selected.snapshot, args, "end_x", "end_y");
			robot.moveMouse(start.x, start.y);
			robot.mouseToggle("down", button);
			try {
				robot.moveMouseSmooth(end.x, end.y);
			} finally {
				robot.mouseToggle("up", button);
			}
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				start_global_logical: start,
				end_global_logical: end,
				button,
			});
		}
		case "computer_scroll": {
			const deltaX = args.delta_x ?? 0;
			const deltaY = requiredNumber(args, "delta_y");
			if (!Number.isInteger(deltaX) || !Number.isInteger(deltaY)) {
				throw new Error("delta_x and delta_y must be integers.");
			}
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			const point = pointFromSnapshot(selected.snapshot, args);
			robot.moveMouse(point.x, point.y);
			robot.scrollMouse(deltaX, deltaY);
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				global_logical: point,
				delta_x: deltaX,
				delta_y: deltaY,
			});
		}
		case "computer_type": {
			const text = requiredString(args, "text");
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			robot.typeString(text);
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				characters: [...text].length,
			});
		}
		case "computer_key": {
			const key = requiredString(args, "key");
			const modifiers = args.modifiers ?? [];
			if (
				!Array.isArray(modifiers) ||
				!modifiers.every(
					(modifier) =>
						typeof modifier === "string" &&
						["alt", "command", "control", "shift", "right_shift"].includes(
							modifier,
						),
				)
			) {
				throw new Error("modifiers contains an unsupported value.");
			}
			const robot = await loadRobot();
			const selected = await consumeSnapshot(args);
			robot.keyTap(key, modifiers);
			return postActionResult(selected, selected.snapshot.id, {
				ok: true,
				key,
				modifiers,
			});
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

export async function main() {
	const server = new Server(
		{ name: SERVER_NAME, version: SERVER_VERSION },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		try {
			return await callTool(request.params.name, request.params.arguments);
		} catch (error) {
			return errorResult(error);
		}
	});

	await server.connect(new StdioServerTransport());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
	await main();
}
