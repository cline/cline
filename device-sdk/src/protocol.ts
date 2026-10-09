/**
 * Cline Device protocol (v1).
 *
 * Transport: one WebSocket per device at ws://<bridge>:<port>/device.
 * Text frames carry JSON objects with a `t` discriminator. Binary frames carry
 * audio (see {@link AUDIO_FRAME_HEADER_BYTES}). Every message is kept small so
 * the ESP32 can parse it with a fixed-size buffer (see {@link MAX_TEXT_FRAME}).
 */

export const PROTOCOL_VERSION = 1;
export const MAX_TEXT_FRAME = 1024;
/** Typed prompts stay within the device’s fixed draft buffer. */
export const MAX_PROMPT_LENGTH = 384;

/** Audio: signed 16-bit little-endian mono PCM. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_BITS = 16;
export const AUDIO_CHANNELS = 1;
/** Binary frame = u16 LE sequence number followed by PCM bytes. */
export const AUDIO_FRAME_HEADER_BYTES = 2;
export const MAX_RECORDING_SECONDS = 60;
export const MAX_RECORDING_BYTES =
	AUDIO_SAMPLE_RATE * (AUDIO_BITS / 8) * AUDIO_CHANNELS * MAX_RECORDING_SECONDS;

export type DeviceState =
	| "idle"
	| "working"
	| "waiting"
	| "listening"
	| "thinking"
	| "done"
	| "error"
	| "offline";

export interface PendingApproval {
	id: string;
	summary: string;
}

/** Where a typed prompt or voice transcript is delivered. */
export type PromptTarget = "followup" | "new" | "cloud";

export interface DeviceStateMessage {
	t: "state";
	state: DeviceState;
	/** Short label for the running tool (bash tools show the command). */
	tool?: string;
	/** Latest visible activity, retained until another event replaces it. */
	activity?: { kind: "status" | "tool" | "thinking" | "text"; text: string };
	session?: string;
	approval: PendingApproval | null;
	transcript?: string;
	/** Last line of the agent reply after a turn finishes. */
	reply?: string;
	/** Short error / exit code label. */
	err?: string;
}

export type PromptResult = {
	t: "prompt";
	id: string;
	status: "submitted" | "error";
	target?: PromptTarget;
	session?: string;
	reason?: string;
};

export type BridgeToDevice =
	| PromptResult
	| DeviceStateMessage
	| { t: "paired"; token: string; name: string }
	| { t: "welcome"; v: number; name: string }
	| { t: "auth_error"; reason: string }
	| {
			t: "voice";
			status: "transcribed" | "starting" | "submitted" | "cancelled" | "error";
			text?: string;
			target?: PromptTarget;
			session?: string;
			/** Cancel window in ms (only with status "transcribed"). */
			cancel_ms?: number;
	  }
	| { t: "stats"; sessions: number; today: number }
	| { t: "error"; reason: string };

export type DeviceToBridge =
	| { t: "prompt"; id: string; text: string; target?: "auto" | "new" }
	| { t: "hello"; token: string; fw?: string }
	| { t: "pair"; code: string; name?: string }
	| { t: "approve"; id: string }
	| { t: "deny"; id: string }
	| { t: "abort" }
	| { t: "stats" }
	| {
			t: "voice_start";
			rate?: number;
			bits?: number;
			ch?: number;
			/**
			 * "new" always starts a parallel task; "auto" (default) follows up on
			 * the active session, or starts a task when nothing is running.
			 */
			target?: "auto" | "new";
	  }
	| { t: "voice_end" }
	| { t: "voice_cancel" }
	/** Skip the remaining cancel window and submit now. */
	| { t: "voice_confirm" };

export function parseDeviceMessage(raw: string): DeviceToBridge | undefined {
	if (new TextEncoder().encode(raw).byteLength > MAX_TEXT_FRAME)
		return undefined;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== "object") return undefined;
	const msg = value as Record<string, unknown>;
	const str = (k: string) => typeof msg[k] === "string" && msg[k] !== "";
	switch (msg.t) {
		case "prompt":
			return str("id") &&
				(msg.id as string).length <= 32 &&
				typeof msg.text === "string" &&
				msg.text.trim().length > 0 &&
				msg.text.length <= MAX_PROMPT_LENGTH &&
				[...msg.text].every(
					(ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127,
				) &&
				(msg.target === undefined ||
					msg.target === "auto" ||
					msg.target === "new")
				? (msg as DeviceToBridge)
				: undefined;
		case "hello":
			return str("token") ? (msg as DeviceToBridge) : undefined;
		case "pair":
			return str("code") ? (msg as DeviceToBridge) : undefined;
		case "approve":
		case "deny":
			return str("id") ? (msg as DeviceToBridge) : undefined;
		case "abort":
		case "stats":
		case "voice_start":
		case "voice_end":
		case "voice_cancel":
		case "voice_confirm":
			return msg as DeviceToBridge;
		default:
			return undefined;
	}
}

/** Truncate to `max` characters on a single line, adding an ellipsis. */
export function clip(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
