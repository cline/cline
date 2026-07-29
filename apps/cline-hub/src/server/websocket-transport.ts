import { utf8ByteLength } from "@cline/core";

export function websocketPayloadByteLength(
	payload: string | ArrayBufferView,
): number {
	return typeof payload === "string"
		? utf8ByteLength(payload)
		: payload.byteLength;
}

export function rejectOversizedWebSocketPayload(
	payload: string | ArrayBufferView,
	maxPayloadBytes: number,
	close: (code: number, reason: string) => void,
): boolean {
	if (websocketPayloadByteLength(payload) <= maxPayloadBytes) return false;
	close(1009, "WebSocket message exceeds maximum payload");
	return true;
}
