/**
 * Cline Pet device protocol (v1).
 *
 * Transport: one WebSocket per device at ws://<bridge>:<port>/device.
 * Text frames carry JSON objects with a `t` discriminator. Binary frames carry
 * audio (see {@link AUDIO_FRAME_HEADER_BYTES}). Every message is kept small so
 * the ESP32 can parse it with a fixed-size buffer (see {@link MAX_TEXT_FRAME}).
 */

export const PROTOCOL_VERSION = 1;
export const MAX_TEXT_FRAME = 1024;

/** Audio: signed 16-bit little-endian mono PCM. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_BITS = 16;
export const AUDIO_CHANNELS = 1;
/** Binary frame = u16 LE sequence number followed by PCM bytes. */
export const AUDIO_FRAME_HEADER_BYTES = 2;
export const MAX_RECORDING_SECONDS = 60;
export const MAX_RECORDING_BYTES =
	AUDIO_SAMPLE_RATE * (AUDIO_BITS / 8) * AUDIO_CHANNELS * MAX_RECORDING_SECONDS;

export type PetState =
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

/** Where a voice transcript was (or will be) delivered. */
export type VoiceTarget = "followup" | "new";

export interface DeviceStateMessage {
	t: "state";
	state: PetState;
	/** Short label for the running tool (bash tools show the command). */
	tool?: string;
	session?: string;
	approval: PendingApproval | null;
	transcript?: string;
	/** Last line of the agent reply after a turn finishes. */
	reply?: string;
	/** Short error / exit code label. */
	err?: string;
}

export type BridgeToDevice =
	| DeviceStateMessage
	| { t: "paired"; token: string; name: string }
	| { t: "welcome"; v: number; name: string }
	| { t: "auth_error"; reason: string }
	| {
			t: "voice";
			status: "transcribed" | "submitted" | "cancelled" | "error";
			text?: string;
			target?: VoiceTarget;
			session?: string;
			/** Cancel window in ms (only with status "transcribed"). */
			cancel_ms?: number;
	  }
	| { t: "stats"; sessions: number; today: number }
	| { t: "error"; reason: string };

export type DeviceToBridge =
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
	if (raw.length > MAX_TEXT_FRAME) return undefined;
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
