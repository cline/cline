export const MAX_RECORDED_AUDIO_BYTES = 25 * 1024 * 1024;

// A binary recording expands to four base64 characters for every three bytes.
export const MAX_RECORDED_AUDIO_BASE64_BYTES =
	4 * Math.ceil(MAX_RECORDED_AUDIO_BYTES / 3);

/**
 * Local transport payload budget.
 *
 * Bun enforces maxPayloadLength before the sidecar can validate a command, and
 * the default previously tied the whole transport to the ~34 MB voice-recording
 * math above. That silently bricked image-heavy chats: a local attach replays
 * the full conversation, so a session whose history carried base64 tool images
 * could exceed the cap with its transport being the only failure visible (the
 * socket dies with close code 1006 and no surfaced reason). History blobs now
 * live on disk as `image_ref` blocks (see session-blob-store.ts), but a local
 * machine still has no reason to reject multi-megabyte sessions, so the
 * transport headroom is generous and environment-tunable.
 */
export const DEFAULT_MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES =
	512 * 1024 * 1024;

const VOICE_SEND_HEADROOM_BYTES = 1024 * 1024;

export function maxDesktopTransportPayloadBytes(): number {
	if (
		typeof process !== "undefined" &&
		process.env?.CLINE_DESKTOP_MAX_TRANSPORT_PAYLOAD_BYTES
	) {
		const parsed = Number(
			process.env.CLINE_DESKTOP_MAX_TRANSPORT_PAYLOAD_BYTES,
		);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return DEFAULT_MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES;
}

export const MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES = maxDesktopTransportPayloadBytes();

/**
 * A recording at the composer cap plus envelope/metadata headroom must always
 * be sendable through the transport.
 */
export const MAX_RECORDED_AUDIO_TRANSPORT_REQUIREMENT =
	MAX_RECORDED_AUDIO_BASE64_BYTES + VOICE_SEND_HEADROOM_BYTES;
