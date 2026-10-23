import { createSecureChannel } from "@cline/hub-pairing";
import { describe, expect, it } from "vitest";
import {
	bindRelayPayload,
	openBoundRelayPayload,
	RelayPayloadBindingError,
} from "./sealed-payload";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("sealed relay payload binding", () => {
	it("detects relay renumbering after real authenticated decryption", () => {
		const deviceToHub = new Uint8Array(32).fill(0x31);
		const hubToDevice = new Uint8Array(32).fill(0x62);
		const sender = createSecureChannel({
			role: "device",
			sendKey: deviceToHub,
			recvKey: hubToDevice,
		});
		const receiver = createSecureChannel({
			role: "hub",
			sendKey: hubToDevice,
			recvKey: deviceToHub,
		});
		const sealed = sender.encryptBytes(
			bindRelayPayload({
				channelId: "chn_one",
				seq: 1,
				payload: encoder.encode("command"),
			}),
		);

		// The ciphertext is authentic, but a relay that changes its plaintext
		// envelope from seq=1 to seq=2 cannot make the authenticated inner copy agree.
		expect(() =>
			openBoundRelayPayload(receiver.decryptBytes(sealed), {
				channelId: "chn_one",
				seq: 2,
			}),
		).toThrow(/does not match outer sequence/);
	});

	it("round-trips a payload only under the same channel and sequence", () => {
		const bound = bindRelayPayload({
			channelId: "chn_one",
			seq: 7,
			payload: encoder.encode("hub frame"),
		});

		expect(
			decoder.decode(
				openBoundRelayPayload(bound, { channelId: "chn_one", seq: 7 }),
			),
		).toBe("hub frame");
		expect(() =>
			openBoundRelayPayload(bound, { channelId: "chn_one", seq: 8 }),
		).toThrow(RelayPayloadBindingError);
		expect(() =>
			openBoundRelayPayload(bound, { channelId: "chn_two", seq: 7 }),
		).toThrow(RelayPayloadBindingError);
	});

	it.each([
		0,
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
	])("refuses invalid sequence %s", (seq) => {
		expect(() =>
			bindRelayPayload({ channelId: "chn", seq, payload: new Uint8Array() }),
		).toThrow(RelayPayloadBindingError);
	});

	it("refuses truncated or version-tampered bindings", () => {
		const bound = bindRelayPayload({
			channelId: "chn",
			seq: 1,
			payload: encoder.encode("frame"),
		});
		expect(() =>
			openBoundRelayPayload(bound.subarray(0, 10), {
				channelId: "chn",
				seq: 1,
			}),
		).toThrow(RelayPayloadBindingError);
		const tampered = bound.slice();
		tampered[3] = 2;
		expect(() =>
			openBoundRelayPayload(tampered, { channelId: "chn", seq: 1 }),
		).toThrow(RelayPayloadBindingError);
	});
});
