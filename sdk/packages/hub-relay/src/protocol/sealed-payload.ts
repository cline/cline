/**
 * Authenticated routing context carried *inside* an encrypted relay payload.
 *
 * The relay needs a plaintext channel id and sequence number to route frames,
 * but those fields are controlled by the relay itself. When a payload codec is
 * present, sealing this copy with the hub frame makes the outer routing fields
 * verifiable by the receiving peer. A relay may still stop forwarding, but it
 * cannot renumber a frame or hide a gap once a later frame arrives.
 *
 * Wire format:
 *
 *   bytes 0..4    magic/version "CRS1"
 *   bytes 4..12   sequence, u64 big-endian
 *   bytes 12..14  channel-id byte length, u16 big-endian
 *   bytes 14..    UTF-8 channel id, then the original hub frame bytes
 */

const MAGIC = new Uint8Array([0x43, 0x52, 0x53, 0x31]);
const FIXED_HEADER_BYTES = 14;
const MAX_CHANNEL_ID_BYTES = 0xffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RelayPayloadBindingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RelayPayloadBindingError";
	}
}

function writeSequence(target: Uint8Array, sequence: number): void {
	let remaining = BigInt(sequence);
	for (let index = 11; index >= 4; index -= 1) {
		target[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
}

function readSequence(source: Uint8Array): number {
	let value = 0n;
	for (let index = 4; index < 12; index += 1) {
		value = (value << 8n) | BigInt(source[index] as number);
	}
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RelayPayloadBindingError(
			"sealed relay sequence is not a safe integer",
		);
	}
	return Number(value);
}

export function bindRelayPayload(input: {
	channelId: string;
	seq: number;
	payload: Uint8Array;
}): Uint8Array {
	if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
		throw new RelayPayloadBindingError(
			`relay sequence must be a positive safe integer, got ${String(input.seq)}`,
		);
	}
	const channel = encoder.encode(input.channelId);
	if (channel.length === 0 || channel.length > MAX_CHANNEL_ID_BYTES) {
		throw new RelayPayloadBindingError(
			`relay channel id must encode to 1-${MAX_CHANNEL_ID_BYTES} bytes`,
		);
	}
	const result = new Uint8Array(
		FIXED_HEADER_BYTES + channel.length + input.payload.length,
	);
	result.set(MAGIC, 0);
	writeSequence(result, input.seq);
	result[12] = (channel.length >>> 8) & 0xff;
	result[13] = channel.length & 0xff;
	result.set(channel, FIXED_HEADER_BYTES);
	result.set(input.payload, FIXED_HEADER_BYTES + channel.length);
	return result;
}

export function openBoundRelayPayload(
	sealedPlaintext: Uint8Array,
	expected: { channelId: string; seq: number },
): Uint8Array {
	if (sealedPlaintext.length < FIXED_HEADER_BYTES) {
		throw new RelayPayloadBindingError(
			"sealed relay payload is shorter than its header",
		);
	}
	for (let index = 0; index < MAGIC.length; index += 1) {
		if (sealedPlaintext[index] !== MAGIC[index]) {
			throw new RelayPayloadBindingError(
				"sealed relay payload magic/version mismatch",
			);
		}
	}
	const seq = readSequence(sealedPlaintext);
	if (seq !== expected.seq) {
		throw new RelayPayloadBindingError(
			`sealed relay sequence ${seq} does not match outer sequence ${expected.seq}`,
		);
	}
	const channelLength =
		((sealedPlaintext[12] as number) << 8) | (sealedPlaintext[13] as number);
	const payloadOffset = FIXED_HEADER_BYTES + channelLength;
	if (channelLength === 0 || payloadOffset > sealedPlaintext.length) {
		throw new RelayPayloadBindingError("sealed relay channel id is malformed");
	}
	const channelId = decoder.decode(
		sealedPlaintext.subarray(FIXED_HEADER_BYTES, payloadOffset),
	);
	if (channelId !== expected.channelId) {
		throw new RelayPayloadBindingError(
			`sealed relay channel ${channelId} does not match outer channel ${expected.channelId}`,
		);
	}
	return sealedPlaintext.slice(payloadOffset);
}
