import { describe, expect, it, vi } from "vitest";
import {
	rejectOversizedWebSocketPayload,
	websocketPayloadByteLength,
} from "./websocket-transport";

describe("dashboard websocket payload limits", () => {
	it("counts UTF-8 and binary bytes", () => {
		expect(websocketPayloadByteLength("é")).toBe(2);
		expect(websocketPayloadByteLength(new Uint8Array(7))).toBe(7);
	});

	it("rejects oversized inbound messages with close code 1009", () => {
		const close = vi.fn();
		expect(rejectOversizedWebSocketPayload("éé", 3, close)).toBe(true);
		expect(close).toHaveBeenCalledWith(
			1009,
			"WebSocket message exceeds maximum payload",
		);
	});

	it("accepts messages at the maximum", () => {
		const close = vi.fn();
		expect(rejectOversizedWebSocketPayload("éé", 4, close)).toBe(false);
		expect(close).not.toHaveBeenCalled();
	});
});
