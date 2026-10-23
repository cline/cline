import { describe, expect, it } from "vitest";
import {
	base64DecodedByteLength,
	base64ToBytes,
	base64ToText,
	bytesToBase64,
	textToBase64,
} from "./base64";
import {
	decodeRelayFrame,
	encodeRelayFrame,
	isRelayErrorCode,
	isRelayProtocolCompatible,
	isValidMachineId,
	RELAY_CLOSE_CODES,
	RELAY_MAX_MACHINE_ID_LENGTH,
	RELAY_PROTOCOL_VERSION,
	relayCloseCode,
	relayFrameCapBytes,
} from "./frames";

function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		bytes[index] = Math.floor(Math.random() * 256);
	}
	return bytes;
}

describe("base64", () => {
	it("round-trips every byte value", () => {
		const bytes = new Uint8Array(256);
		for (let index = 0; index < 256; index += 1) {
			bytes[index] = index;
		}
		expect([...(base64ToBytes(bytesToBase64(bytes)) as Uint8Array)]).toEqual([
			...bytes,
		]);
	});

	it("round-trips every padding remainder", () => {
		for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 100, 1024]) {
			const bytes = randomBytes(length);
			const encoded = bytesToBase64(bytes);
			expect(
				[...(base64ToBytes(encoded) as Uint8Array)],
				`length ${length}`,
			).toEqual([...bytes]);
			expect(base64DecodedByteLength(encoded), `length ${length}`).toBe(length);
		}
	});

	it("round-trips multi-byte utf8 text", () => {
		const text = 'ünïcödé 🚀 {"hub":"protocol"}';
		expect(base64ToText(textToBase64(text))).toBe(text);
	});

	it("rejects non-base64 input", () => {
		expect(base64ToBytes("not*valid")).toBeUndefined();
	});

	// Two distinct strings decoding to the same bytes defeats any "the payload
	// arrived verbatim" check, so non-canonical trailing bits are refused.
	it("refuses non-canonical trailing bits", () => {
		expect([...(base64ToBytes("QQ==") as Uint8Array)]).toEqual([0x41]);
		for (const nonCanonical of ["QR==", "QV==", "Qf==", "AAB=", "AAF="]) {
			expect(base64ToBytes(nonCanonical), nonCanonical).toBeUndefined();
		}
		expect(base64ToBytes("AAA=")).toEqual(new Uint8Array([0, 0]));
	});

	it("refuses malformed padding", () => {
		for (const bad of ["A", "AAAAA", "A===", "=", "AA=A", "AAA==="]) {
			expect(base64ToBytes(bad), bad).toBeUndefined();
		}
	});

	// A plain-object decode table resolves inherited keys; a single character can
	// never be "constructor", but the table must still be prototype-free.
	it("decodes only alphabet characters", () => {
		expect(base64ToBytes("-_")).toBeUndefined();
		expect(base64ToBytes(" AAA")).toBeUndefined();
	});
});

describe("decodeRelayFrame", () => {
	it("accepts a data frame and does not interpret its payload", () => {
		const payload = bytesToBase64(randomBytes(64));
		const decoded = decodeRelayFrame(
			encodeRelayFrame({ t: "data", channelId: "chn_1", seq: 7, payload }),
		);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) {
			return;
		}
		// The payload comes back byte-identical: the relay is a copier, not a parser.
		expect(decoded.frame).toEqual({
			t: "data",
			channelId: "chn_1",
			seq: 7,
			payload,
		});
	});

	it("rejects non-JSON, non-object and unknown frames", () => {
		expect(decodeRelayFrame("{oops").ok).toBe(false);
		expect(decodeRelayFrame("[1,2]").ok).toBe(false);
		const unknown = decodeRelayFrame('{"t":"nope"}');
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) {
			expect(unknown.code).toBe("malformed_frame");
		}
	});

	it("requires a channelId and a positive safe-integer seq on data", () => {
		for (const bad of [
			'{"t":"data","seq":1,"payload":""}',
			'{"t":"data","channelId":"c","payload":""}',
			'{"t":"data","channelId":"c","seq":1.5,"payload":""}',
			'{"t":"data","channelId":"c","seq":0,"payload":""}',
			'{"t":"data","channelId":"c","seq":-1,"payload":""}',
			`{"t":"data","channelId":"c","seq":${Number.MAX_SAFE_INTEGER + 1},"payload":""}`,
			'{"t":"data","channelId":"c","seq":1}',
			'{"t":"data","channelId":"c","seq":1,"payload":42}',
		]) {
			const result = decodeRelayFrame(bad);
			expect(result.ok, bad).toBe(false);
			if (!result.ok) {
				expect(result.code, bad).toBe("malformed_frame");
			}
		}
	});

	it("caps payload size without decoding the payload", () => {
		const oversized = decodeRelayFrame(
			encodeRelayFrame({
				t: "data",
				channelId: "chn_1",
				seq: 1,
				payload: "A".repeat(4096),
			}),
			{ maxPayloadBytes: 1024 },
		);
		expect(oversized.ok).toBe(false);
		if (!oversized.ok) {
			expect(oversized.code).toBe("frame_too_large");
		}
	});

	it("requires a protocolVersion on both handshakes", () => {
		expect(decodeRelayFrame('{"t":"host.register","machineId":"m"}').ok).toBe(
			false,
		);
		expect(decodeRelayFrame('{"t":"client.connect","machineId":"m"}').ok).toBe(
			false,
		);
	});

	it("pins the protocol version", () => {
		expect(isRelayProtocolCompatible(RELAY_PROTOCOL_VERSION)).toBe(true);
		expect(isRelayProtocolCompatible("relay-v0")).toBe(false);
	});
});

describe("close codes", () => {
	it("keeps every error code in the private 4000-4999 range", () => {
		for (const [code, closeCode] of Object.entries(RELAY_CLOSE_CODES)) {
			expect(closeCode, code).toBeGreaterThanOrEqual(4000);
			expect(closeCode, code).toBeLessThan(5000);
		}
	});

	// Every code maps to a distinct number, so an operator reading a close code
	// can always name the condition that produced it.
	it("maps distinct codes to distinct close numbers except the documented pairs", () => {
		const seen = new Map<number, string[]>();
		for (const [code, closeCode] of Object.entries(RELAY_CLOSE_CODES)) {
			seen.set(closeCode, [...(seen.get(closeCode) ?? []), code]);
		}
		const shared = [...seen.values()].filter((codes) => codes.length > 1);
		expect(shared.map((codes) => codes.sort())).toEqual([
			["connection_limit", "channel_limit", "rate_limited"].sort(),
			["handshake_timeout", "heartbeat_timeout"].sort(),
		]);
	});

	// A peer-supplied close code reaches this lookup, so an inherited property name
	// must never resolve to a function. `socket.close(<function>)` throws.
	it("never resolves a prototype property to a close code", () => {
		for (const hostile of [
			"constructor",
			"toString",
			"__proto__",
			"hasOwnProperty",
			"valueOf",
		]) {
			expect(isRelayErrorCode(hostile), hostile).toBe(false);
			expect(typeof relayCloseCode(hostile as never), hostile).toBe("number");
			expect(relayCloseCode(hostile as never), hostile).toBe(
				RELAY_CLOSE_CODES.internal,
			);
		}
		expect(relayCloseCode("normal")).toBe(1000);
		expect(relayCloseCode("machine_gone")).toBe(RELAY_CLOSE_CODES.machine_gone);
	});

	it("normalises an unknown channel.close code instead of passing it through", () => {
		const decoded = decodeRelayFrame(
			'{"t":"channel.close","channelId":"chn_1","code":"constructor"}',
		);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok || decoded.frame.t !== "channel.close") {
			throw new Error("expected a channel.close frame");
		}
		expect(decoded.frame.code).toBe("internal");
	});
});

describe("machine ids", () => {
	it("rejects an over-long or wrong-charset machine id", () => {
		expect(isValidMachineId("mach_air-01.local:2")).toBe(true);
		expect(isValidMachineId("a".repeat(RELAY_MAX_MACHINE_ID_LENGTH))).toBe(
			true,
		);
		expect(isValidMachineId("a".repeat(RELAY_MAX_MACHINE_ID_LENGTH + 1))).toBe(
			false,
		);
		expect(isValidMachineId("")).toBe(false);
		expect(isValidMachineId("mach air")).toBe(false);
		expect(isValidMachineId("mach\nair")).toBe(false);
		expect(isValidMachineId("mach/../air")).toBe(false);
		expect(isValidMachineId(42)).toBe(false);
	});

	it("refuses a host.register or client.connect carrying a hostile id", () => {
		for (const machineId of ["a".repeat(200_000), "id with spaces", "id\n"]) {
			for (const t of ["host.register", "client.connect"]) {
				const result = decodeRelayFrame(
					JSON.stringify({ t, protocolVersion: "relay-v1", machineId }),
				);
				expect(result.ok, `${t} ${machineId.slice(0, 12)}`).toBe(false);
				if (!result.ok) {
					expect(result.code).toBe("malformed_frame");
				}
			}
		}
	});

	it("refuses to register the reserved 'newest' alias while a client may ask for it", () => {
		const registered = decodeRelayFrame(
			'{"t":"host.register","protocolVersion":"relay-v1","machineId":"newest"}',
		);
		expect(registered.ok).toBe(false);
		const requested = decodeRelayFrame(
			'{"t":"client.connect","protocolVersion":"relay-v1","machineId":"newest"}',
		);
		expect(requested.ok).toBe(true);
	});

	it("truncates an over-long label rather than storing it whole", () => {
		const decoded = decodeRelayFrame(
			JSON.stringify({
				t: "host.register",
				protocolVersion: "relay-v1",
				machineId: "mach_air",
				label: "L".repeat(10_000),
			}),
		);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok || decoded.frame.t !== "host.register") {
			throw new Error("expected a host.register frame");
		}
		expect((decoded.frame.label ?? "").length).toBeLessThanOrEqual(256);
	});
});

describe("payload cap", () => {
	it("rejects an oversized frame before parsing it", () => {
		// `JSON.parse` on the whole thing is what the cap is supposed to avoid, so
		// the frame is deliberately not even valid JSON: a decoder that parses
		// first reports malformed_frame, one that measures first reports the cap.
		const text = `{"t":"data","channelId":"c","seq":1,"payload":"${"A".repeat(
			5_000,
		)}`;
		const result = decodeRelayFrame(text, {
			maxPayloadBytes: 512,
			maxFrameBytes: 2_048,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("frame_too_large");
		}
	});

	it("measures the exact decoded byte length, padding included", () => {
		// 4 base64 chars with two pad bytes decode to ONE byte; the old 3/4
		// estimate says three and would refuse a legal frame at the boundary.
		const payload = bytesToBase64(randomBytes(1_024));
		const exact = decodeRelayFrame(
			encodeRelayFrame({ t: "data", channelId: "c", seq: 1, payload }),
			{ maxPayloadBytes: 1_024 },
		);
		expect(exact.ok).toBe(true);
		const overBy1 = decodeRelayFrame(
			encodeRelayFrame({
				t: "data",
				channelId: "c",
				seq: 1,
				payload: bytesToBase64(randomBytes(1_025)),
			}),
			{ maxPayloadBytes: 1_024 },
		);
		expect(overBy1.ok).toBe(false);
	});

	it("attributes a channel-scoped failure to its channel", () => {
		const result = decodeRelayFrame(
			encodeRelayFrame({
				t: "data",
				channelId: "chn_victim",
				seq: 1,
				payload: "A".repeat(4_096),
			}),
			{ maxPayloadBytes: 512 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// Without this the relay cannot tell WHICH channel misbehaved and closes
			// the whole host tunnel.
			expect(result.channelId).toBe("chn_victim");
		}
	});

	it("derives the websocket frame cap from the payload cap", () => {
		expect(relayFrameCapBytes(8 * 1024 * 1024)).toBeGreaterThan(
			8 * 1024 * 1024 * (4 / 3),
		);
		expect(relayFrameCapBytes(64 * 1024 * 1024)).toBeGreaterThan(
			64 * 1024 * 1024 * (4 / 3),
		);
	});
});
