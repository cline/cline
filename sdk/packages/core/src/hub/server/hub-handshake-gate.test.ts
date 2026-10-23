import { describe, expect, it, vi } from "vitest";
import { createHandshakeGate } from "./hub-handshake-gate";

function socketFixture() {
	let onMessage: ((data: unknown) => void) | undefined;
	return {
		socket: {
			on(_event: "message", listener: (data: unknown) => void) {
				onMessage = listener;
			},
		},
		emit(data: unknown) {
			onMessage?.(data);
		},
	};
}

describe("hub handshake gate", () => {
	it("refuses application-sized data before authentication", () => {
		const fixture = socketFixture();
		const overflow = vi.fn();
		createHandshakeGate(fixture.socket, String, overflow);

		fixture.emit("x".repeat(64 * 1024 + 1));

		expect(overflow).toHaveBeenCalledTimes(1);
	});

	it("bounds the aggregate bytes queued before authentication", () => {
		const fixture = socketFixture();
		const overflow = vi.fn();
		createHandshakeGate(fixture.socket, String, overflow);

		fixture.emit("x".repeat(40 * 1024));
		fixture.emit("x".repeat(30 * 1024));

		expect(overflow).toHaveBeenCalledTimes(1);
	});
});
