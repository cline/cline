export const MAX_RECORDED_AUDIO_BYTES = 25 * 1024 * 1024;

// A binary recording expands to four base64 characters for every three bytes.
export const MAX_RECORDED_AUDIO_BASE64_BYTES =
	4 * Math.ceil(MAX_RECORDED_AUDIO_BYTES / 3);

// Bun enforces maxPayloadLength before the sidecar can validate a command.
// Leave room for the JSON transport envelope and media-type metadata so every
// recording accepted by the composer can reach the transcribe_audio handler.
export const MAX_DESKTOP_TRANSPORT_PAYLOAD_BYTES =
	MAX_RECORDED_AUDIO_BASE64_BYTES + 1024 * 1024;
