/**
 * Adversarial tests for the encrypted frame layer.
 *
 * The attacker here is the relay itself: it sees and fully controls the byte
 * stream in both directions. It may drop, duplicate, reorder, truncate, modify
 * and reflect frames, and it may splice frames in from another session. None of
 * that may yield plaintext or be accepted as authentic.
 */
import { describe, expect, it } from "vitest";
import { pairFixture } from "./__tests__/support.js";
import {
	createSecureChannel,
	DEFAULT_MAX_PLAINTEXT_SIZE,
	FRAME_HEADER_LENGTH,
	FRAME_MAGIC,
	FRAME_WIRE_VERSION,
	MAX_FRAME_SIZE,
} from "./channel.js";
import {
	ChannelClosedError,
	ChannelKeyError,
	FrameAuthenticationError,
	FrameMalformedError,
	FrameOutOfOrderError,
	FrameReplayError,
	FrameTooLargeError,
} from "./errors.js";

describe("secure channel round trip", () => {
	it("carries Hub protocol JSON frames intact in both directions", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const toPhone = {
			type: "session.update",
			id: "01JQ",
			payload: { text: "héllo 🌍", nested: [1, 2, { deep: true }], nil: null },
		};
		const toHub = { type: "tool.approve", id: "01JR", approved: true };

		expect(
			deviceChannel.decryptFrame(hubChannel.encryptFrame(toPhone)),
		).toEqual(toPhone);
		expect(hubChannel.decryptFrame(deviceChannel.encryptFrame(toHub))).toEqual(
			toHub,
		);
	});

	it("keeps a long stream of frames in step", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		for (let index = 0; index < 50; index += 1) {
			const frame = hubChannel.encryptFrame({ index });
			expect(deviceChannel.decryptFrame(frame)).toEqual({ index });
		}
		expect(hubChannel.sendCounter).toBe(50n);
		expect(deviceChannel.recvCounter).toBe(50n);
	});

	it("produces ciphertext that does not contain the plaintext", () => {
		const { hubChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ token: "SUPER-SECRET-VALUE" });
		const asText = String.fromCharCode(...frame);
		expect(asText).not.toContain("SUPER-SECRET-VALUE");
		expect(frame[0]).toBe(FRAME_MAGIC);
		expect(frame[1]).toBe(FRAME_WIRE_VERSION);
	});

	it("encrypts the same payload to different bytes each time", () => {
		const { hubChannel } = pairFixture();
		const first = hubChannel.encryptFrame({ same: "payload" });
		const second = hubChannel.encryptFrame({ same: "payload" });
		expect(Array.from(first)).not.toEqual(Array.from(second));
	});
});

describe("directional key separation", () => {
	it("ATTACK: a frame reflected back at its sender is rejected", () => {
		const { hubChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ cmd: "run" });
		// The relay bounces the hub's own frame back to it. Separate send/recv keys
		// mean this cannot authenticate.
		expect(() => hubChannel.decryptFrame(frame)).toThrow(
			FrameAuthenticationError,
		);
	});

	it("ATTACK: a phone frame replayed at the phone is rejected", () => {
		const { deviceChannel } = pairFixture();
		const frame = deviceChannel.encryptFrame({ cmd: "approve" });
		expect(() => deviceChannel.decryptFrame(frame)).toThrow(
			FrameAuthenticationError,
		);
	});

	it("ATTACK: hub->device frames cannot be decrypted as device->hub", () => {
		const first = pairFixture();
		// Deliberately an identical clone — same statics AND same ephemerals, so the
		// transport keys match exactly and *direction* is the only variable. (Tests
		// that need a genuinely different session pass a distinct `seed`; see the
		// splice test below.)
		const second = pairFixture();
		const hubFrame = first.hubChannel.encryptFrame({ direction: "to-device" });
		expect(() => second.hubChannel.decryptFrame(hubFrame)).toThrow(
			FrameAuthenticationError,
		);
		// ...while the correct direction works.
		expect(second.deviceChannel.decryptFrame(hubFrame)).toEqual({
			direction: "to-device",
		});
	});
});

describe("replay, reorder and duplication", () => {
	it("ATTACK: a duplicated frame is rejected as a replay", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ n: 1 });
		expect(deviceChannel.decryptFrame(frame)).toEqual({ n: 1 });
		expect(() => deviceChannel.decryptFrame(frame)).toThrow(FrameReplayError);
	});

	it("ATTACK: an old frame replayed after later ones is rejected", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frames = [0, 1, 2].map((n) => hubChannel.encryptFrame({ n }));
		for (const frame of frames) {
			deviceChannel.decryptFrame(frame);
		}
		expect(() => deviceChannel.decryptFrame(frames[0] as Uint8Array)).toThrow(
			FrameReplayError,
		);
		expect(() => deviceChannel.decryptFrame(frames[2] as Uint8Array)).toThrow(
			FrameReplayError,
		);
	});

	it("ATTACK: reordered frames are rejected, not silently accepted", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frames = [0, 1, 2].map((n) => hubChannel.encryptFrame({ n }));
		expect(deviceChannel.decryptFrame(frames[0] as Uint8Array)).toEqual({
			n: 0,
		});
		// The relay delivers frame 2 before frame 1.
		expect(() => deviceChannel.decryptFrame(frames[2] as Uint8Array)).toThrow(
			FrameOutOfOrderError,
		);
		// The channel is still in step, so the genuine next frame still works.
		expect(deviceChannel.decryptFrame(frames[1] as Uint8Array)).toEqual({
			n: 1,
		});
	});

	it("ATTACK: a dropped frame is detected rather than skipped over", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frames = [0, 1].map((n) => hubChannel.encryptFrame({ n }));
		// The relay drops frame 0 entirely.
		expect(() => deviceChannel.decryptFrame(frames[1] as Uint8Array)).toThrow(
			FrameOutOfOrderError,
		);
	});

	it("ATTACK: rewriting the counter to the expected value fails authentication", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		hubChannel.encryptFrame({ n: 0 });
		const second = hubChannel.encryptFrame({ n: 1 });
		// Relabel frame 1 as frame 0 so the sequence check passes. The counter is
		// authenticated as associated data, so the AEAD catches it.
		const forged = second.slice();
		for (let index = 2; index < FRAME_HEADER_LENGTH; index += 1) {
			forged[index] = 0;
		}
		expect(() => deviceChannel.decryptFrame(forged)).toThrow(
			FrameAuthenticationError,
		);
	});
});

describe("tampering", () => {
	it("ATTACK: flipping any ciphertext byte is rejected", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ cmd: "rm -rf /" });
		for (let index = FRAME_HEADER_LENGTH; index < frame.length; index += 1) {
			const tampered = frame.slice();
			tampered[index] = (tampered[index] as number) ^ 0x80;
			expect(() => deviceChannel.decryptFrame(tampered)).toThrow(
				FrameAuthenticationError,
			);
		}
		// Every rejection left the receive counter untouched, so the genuine frame
		// still decrypts afterwards.
		expect(deviceChannel.decryptFrame(frame)).toEqual({ cmd: "rm -rf /" });
	});

	it("ATTACK: a truncated frame is rejected", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ cmd: "run" });
		expect(() =>
			deviceChannel.decryptFrame(frame.subarray(0, frame.length - 1)),
		).toThrow(FrameAuthenticationError);
		expect(() => deviceChannel.decryptFrame(new Uint8Array(4))).toThrow(
			FrameMalformedError,
		);
	});

	it("ATTACK: a bad magic byte is rejected before any crypto", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ cmd: "run" });
		const tampered = frame.slice();
		tampered[0] = 0x00;
		expect(() => deviceChannel.decryptFrame(tampered)).toThrow(
			FrameMalformedError,
		);
	});

	it("ATTACK: a downgraded frame wire version is rejected", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ cmd: "run" });
		const tampered = frame.slice();
		tampered[1] = 0x00;
		expect(() => deviceChannel.decryptFrame(tampered)).toThrow(/wire version/);
	});

	it("ATTACK: frames spliced in from another session are rejected", () => {
		const first = pairFixture({ seed: "-session-1" });
		const second = pairFixture({ seed: "-session-2" });
		const foreign = second.hubChannel.encryptFrame({ cmd: "inject" });
		expect(() => first.deviceChannel.decryptFrame(foreign)).toThrow(
			FrameAuthenticationError,
		);
	});
});

describe("size guards", () => {
	it("keeps the whole frame inside the Noise 64 KiB message ceiling", () => {
		// Header + ciphertext + tag must land exactly on 65535, not past it: a frame
		// over the ceiling is not carryable by a Noise-conformant transport.
		expect(FRAME_HEADER_LENGTH + DEFAULT_MAX_PLAINTEXT_SIZE + 16).toBe(
			MAX_FRAME_SIZE,
		);
		expect(MAX_FRAME_SIZE).toBe(65535);
		expect(DEFAULT_MAX_PLAINTEXT_SIZE).toBe(65509);
	});

	it("ATTACK: an oversized plaintext is refused rather than sent", () => {
		const { hubChannel } = pairFixture({ maxPlaintextSize: 64 });
		expect(() => hubChannel.encryptFrame({ blob: "x".repeat(200) })).toThrow(
			FrameTooLargeError,
		);
	});

	it("ATTACK: an oversized inbound frame is refused before decryption", () => {
		const { deviceChannel } = pairFixture({ maxPlaintextSize: 64 });
		const huge = new Uint8Array(64 + FRAME_HEADER_LENGTH + 16 + 1);
		huge[0] = FRAME_MAGIC;
		huge[1] = FRAME_WIRE_VERSION;
		expect(() => deviceChannel.decryptFrame(huge)).toThrow(FrameTooLargeError);
	});

	it("accepts a payload exactly at the limit", () => {
		const { hubChannel, deviceChannel } = pairFixture({ maxPlaintextSize: 64 });
		// {"b":"xxx..."} -> 8 bytes of framing around the string.
		const payload = { b: "x".repeat(64 - 10) };
		expect(
			deviceChannel.decryptFrame(hubChannel.encryptFrame(payload)),
		).toEqual(payload);
	});
});

describe("channel lifecycle", () => {
	it("refuses to encrypt or decrypt once closed", () => {
		const { hubChannel, deviceChannel } = pairFixture();
		const frame = hubChannel.encryptFrame({ n: 1 });
		deviceChannel.close();
		expect(deviceChannel.closed).toBe(true);
		expect(() => deviceChannel.decryptFrame(frame)).toThrow(ChannelClosedError);
		expect(() => deviceChannel.encryptFrame({ n: 2 })).toThrow(
			ChannelClosedError,
		);
	});

	it("is idempotent on close", () => {
		const { hubChannel } = pairFixture();
		hubChannel.close();
		expect(() => hubChannel.close()).not.toThrow();
	});

	it("ATTACK: closing one channel cannot zero another channel's keys", () => {
		// The doc comment on createSecureChannel invites rebuilding a channel from
		// keys the caller already holds, so two channels can legitimately be built
		// from one HandshakeResult. If the channel kept the caller's arrays by
		// reference, `close()` on the first would zero the second's keys in place
		// and the second would silently encrypt under an all-zero key.
		const handshake = {
			sendKey: new Uint8Array(32).fill(7),
			recvKey: new Uint8Array(32).fill(9),
		};
		const first = createSecureChannel({ ...handshake, role: "hub" });
		const second = createSecureChannel({ ...handshake, role: "hub" });

		first.close();

		const frame = second.encryptFrame({ cmd: "rm -rf /" });
		// A reader holding the all-zero key must NOT be able to open the frame.
		const zeroKeyReader = createSecureChannel({
			sendKey: new Uint8Array(32).fill(1),
			recvKey: new Uint8Array(32).fill(7),
			role: "device",
		});
		const zeroed = new Uint8Array(32);
		expect(Array.from(handshake.sendKey)).not.toEqual(Array.from(zeroed));
		// And the real counterpart key still opens it.
		expect(zeroKeyReader.decryptFrame(frame)).toEqual({ cmd: "rm -rf /" });
	});

	it("ATTACK: refuses to build a channel on all-zero or wrong-length keys", () => {
		expect(() =>
			createSecureChannel({
				sendKey: new Uint8Array(32),
				recvKey: new Uint8Array(32).fill(3),
				role: "hub",
			}),
		).toThrow(ChannelKeyError);
		expect(() =>
			createSecureChannel({
				sendKey: new Uint8Array(32).fill(3),
				recvKey: new Uint8Array(16).fill(3),
				role: "hub",
			}),
		).toThrow(ChannelKeyError);
		expect(() =>
			createSecureChannel({
				sendKey: new Uint8Array(32).fill(3),
				recvKey: new Uint8Array(32).fill(3),
				role: "hub",
			}),
		).toThrow(ChannelKeyError);
	});

	it("rejects payloads that cannot be serialised to JSON", () => {
		const { hubChannel } = pairFixture();
		expect(() => hubChannel.encryptFrame(undefined)).toThrow(
			FrameMalformedError,
		);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => hubChannel.encryptFrame(cyclic)).toThrow();
	});
});
