/**
 * Id generation with no dependencies, so the RN-facing graph stays external-free.
 *
 * Relay ids are routing handles, not credentials: a channel id is only ever
 * meaningful on the one socket pair that owns it, and a machine id is
 * account-scoped by the relay. Nothing here is a security boundary — account
 * tokens and the pairing layer's keys are.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

let counter = 0;

function randomSuffix(length: number): string {
	let out = "";
	for (let index = 0; index < length; index += 1) {
		out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return out;
}

export function createRelayId(prefix: string): string {
	counter = (counter + 1) % 0xffff;
	return `${prefix}${Date.now().toString(36)}_${counter.toString(36)}${randomSuffix(6)}`;
}

export function createChannelId(): string {
	return createRelayId("chn_");
}

export function createMachineId(): string {
	return createRelayId("mach_");
}
