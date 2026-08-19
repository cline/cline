/**
 * The native bridge contract between the webview and the broker.
 *
 * Closed, typed command schema — there is deliberately NO generic
 * `invoke(method, payload)` escape hatch. Unknown commands are rejected,
 * frames are bounded, and prompt/steer text is additionally capped and
 * scanned for control characters. The webview authenticates with the
 * per-launch bridge secret as the FIRST frame (never in a URL).
 */

import { z } from "zod";
import type { PublicDesktopError } from "./errors";
import type { DesktopProjection } from "./projection";

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Hard cap for any single bridge frame (either direction). */
export const MAX_BRIDGE_FRAME_BYTES = 1024 * 1024; // 1 MiB
/** Additional cap for prompt and steering text. */
export const MAX_PROMPT_BYTES = 256 * 1024; // 256 KiB

/**
 * Reject NUL and C0 control characters except tab/newline/carriage
 * return. Applied to prompt, steer, and reason text from the webview.
 */
export function containsForbiddenControlChars(text: string): boolean {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: scanning is the point
	return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

/** Browser-safe UTF-8 byte length (works in webview and broker). */
export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

const boundedText = (maxBytes: number) =>
	z
		.string()
		.min(1)
		.refine((text) => utf8ByteLength(text) <= maxBytes, {
			message: `text exceeds ${maxBytes} bytes`,
		})
		.refine((text) => !containsForbiddenControlChars(text), {
			message: "text contains forbidden control characters",
		});

/**
 * Client request IDs double as Gateway idempotency keys: a webview retry
 * of the same command reuses the same ID and can never duplicate a
 * mutation (8–128 URL-safe chars, same contract as the Gateway).
 */
export const ClientRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

const shortText = boundedText(4 * 1024);

// -----------------------------------------------------------------------------
// Webview -> broker commands (closed set)
// -----------------------------------------------------------------------------

export const BridgeCommandSchema = z.discriminatedUnion("command", [
	z
		.object({
			command: z.literal("app.initialize"),
		})
		.strict(),
	z
		.object({
			command: z.literal("gateway.reconnect"),
		})
		.strict(),
	z
		.object({
			command: z.literal("bot.select"),
			botId: z.string().min(1).max(256),
		})
		.strict(),
	z
		.object({
			command: z.literal("workspace.select"),
			workspaceId: z.string().min(1).max(256),
		})
		.strict(),
	z
		.object({
			command: z.literal("workspace.open"),
		})
		.strict(),
	z
		.object({
			command: z.literal("session.select"),
			sessionId: z.string().min(1).max(256).optional(),
		})
		.strict(),
	z
		.object({
			command: z.literal("run.start"),
			clientRequestId: ClientRequestIdSchema,
			botId: z.string().min(1).max(256),
			sessionId: z.string().min(1).max(256).optional(),
			workspaceId: z.string().min(1).max(256).optional(),
			providerId: z.string().min(1).max(256).optional(),
			modelId: z.string().min(1).max(512).optional(),
			prompt: boundedText(MAX_PROMPT_BYTES),
		})
		.strict(),
	z
		.object({
			command: z.literal("run.steer"),
			clientRequestId: ClientRequestIdSchema,
			runId: z.string().min(1).max(256),
			text: boundedText(MAX_PROMPT_BYTES),
		})
		.strict(),
	z
		.object({
			command: z.literal("run.interrupt"),
			clientRequestId: ClientRequestIdSchema,
			runId: z.string().min(1).max(256),
			reason: shortText.optional(),
		})
		.strict(),
	z
		.object({
			command: z.literal("run.retry"),
			clientRequestId: ClientRequestIdSchema,
			runId: z.string().min(1).max(256),
		})
		.strict(),
	z
		.object({
			command: z.literal("approval.resolve"),
			clientRequestId: ClientRequestIdSchema,
			requestId: z.string().min(1).max(256),
			approved: z.boolean(),
			reason: shortText.optional(),
		})
		.strict(),
	z
		.object({
			command: z.literal("diagnostics.reveal"),
		})
		.strict(),
]);

export type BridgeCommand = z.infer<typeof BridgeCommandSchema>;
export type BridgeCommandName = BridgeCommand["command"];

export const BRIDGE_COMMAND_NAMES = [
	"app.initialize",
	"gateway.reconnect",
	"bot.select",
	"workspace.select",
	"workspace.open",
	"session.select",
	"run.start",
	"run.steer",
	"run.interrupt",
	"run.retry",
	"approval.resolve",
	"diagnostics.reveal",
] as const satisfies readonly BridgeCommandName[];

// -----------------------------------------------------------------------------
// Frames
// -----------------------------------------------------------------------------

/** First frame of every webview connection. The secret never logs. */
export const BridgeAuthFrameSchema = z
	.object({
		v: z.literal(BRIDGE_PROTOCOL_VERSION),
		type: z.literal("authenticate"),
		secret: z.string().min(8).max(512),
	})
	.strict();

export type BridgeAuthFrame = z.infer<typeof BridgeAuthFrameSchema>;

export const BridgeCommandFrameSchema = z
	.object({
		v: z.literal(BRIDGE_PROTOCOL_VERSION),
		type: z.literal("command"),
		/** Correlates the eventual `command.result` frame. */
		id: z.string().min(1).max(128),
		payload: BridgeCommandSchema,
	})
	.strict();

export type BridgeCommandFrame = z.infer<typeof BridgeCommandFrameSchema>;

export interface BridgeAuthenticatedFrame {
	v: typeof BRIDGE_PROTOCOL_VERSION;
	type: "authenticated";
}

export interface BridgeProjectionReplaceFrame {
	v: typeof BRIDGE_PROTOCOL_VERSION;
	type: "projection.replace";
	projection: DesktopProjection;
}

export interface BridgeProjectionPatchFrame {
	v: typeof BRIDGE_PROTOCOL_VERSION;
	type: "projection.patch";
	/** Applies only when the webview's current revision matches. */
	baseRevision: number;
	revision: number;
	patch: Partial<DesktopProjection>;
	/** Optional projection properties removed by this patch. */
	clearedKeys?: (keyof DesktopProjection)[];
}

export interface BridgeCommandResultFrame {
	v: typeof BRIDGE_PROTOCOL_VERSION;
	type: "command.result";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: PublicDesktopError;
}

export type BrokerFrame =
	| BridgeAuthenticatedFrame
	| BridgeProjectionReplaceFrame
	| BridgeProjectionPatchFrame
	| BridgeCommandResultFrame;

export type ParsedWebviewFrame =
	| { kind: "authenticate"; frame: BridgeAuthFrame }
	| { kind: "command"; frame: BridgeCommandFrame }
	| { kind: "invalid"; reason: string };

/** Parse one raw webview frame; enforces size and the closed schema. */
export function parseWebviewFrame(
	raw: string | Uint8Array,
): ParsedWebviewFrame {
	const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
	const bytes = typeof raw === "string" ? utf8ByteLength(raw) : raw.length;
	if (bytes > MAX_BRIDGE_FRAME_BYTES) {
		return {
			kind: "invalid",
			reason: `frame exceeds ${MAX_BRIDGE_FRAME_BYTES} bytes`,
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { kind: "invalid", reason: "frame is not valid JSON" };
	}
	const auth = BridgeAuthFrameSchema.safeParse(value);
	if (auth.success) {
		return { kind: "authenticate", frame: auth.data };
	}
	const command = BridgeCommandFrameSchema.safeParse(value);
	if (command.success) {
		return { kind: "command", frame: command.data };
	}
	return {
		kind: "invalid",
		reason: "frame matches neither the auth nor the command schema",
	};
}

/**
 * Development-only bridge credentials for running the webview against a
 * broker without the Tauri shell (headless `next dev` + `dev:broker`).
 * The broker honors this secret ONLY when it was explicitly started with
 * `GATEWAY_DESKTOP_DEV_BRIDGE=1`; production launches always use the
 * random per-launch secret handed over by the Tauri shell.
 */
export const DEV_BRIDGE_PORT = 4517;
export const DEV_BRIDGE_SECRET = "gateway-desktop-dev-insecure";
