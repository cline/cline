/**
 * Test-only helpers. Lives under `__tests__/` so it is excluded from the
 * published build (see tsconfig.build.json) and from the no-node-builtins scan.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "../bytes.js";
import type { SecureChannel } from "../channel.js";
import { generateDeviceKeyPair } from "../keys.js";
import {
	acceptPairingOffer,
	createHubPairingSession,
	createPairingOffer,
	type PairingOffer,
} from "../pairing.js";
import type { RandomSource } from "../random.js";
import {
	createInMemoryDeviceStore,
	DeviceRegistry,
	type PairedDeviceRecord,
} from "../registry.js";

/**
 * Deterministic CSPRNG stand-in: SHA-256 of (seed || counter). Lets tests
 * reproduce exact handshake bytes without ever touching the real RNG.
 */
export function deterministicRandom(seed: string): RandomSource {
	const seedBytes = utf8ToBytes(seed);
	let counter = 0;
	return (length: number) => {
		const out = new Uint8Array(length);
		let offset = 0;
		while (offset < length) {
			const block = sha256(concatBytes(seedBytes, utf8ToBytes(`:${counter}`)));
			counter += 1;
			const take = Math.min(block.length, length - offset);
			out.set(block.subarray(0, take), offset);
			offset += take;
		}
		return out;
	};
}

export const FIXED_NOW = Date.parse("2026-08-01T12:00:00.000Z");

export interface PairedFixture {
	hubKeyPair: ReturnType<typeof generateDeviceKeyPair>;
	deviceKeyPair: ReturnType<typeof generateDeviceKeyPair>;
	offer: PairingOffer;
	uri: string;
	hubChannel: SecureChannel;
	deviceChannel: SecureChannel;
	deviceId: string;
	deviceFingerprint: string;
	hubFingerprint: string;
}

/** Runs the full QR ceremony and hands back both live channels. */
export function pairFixture(
	options: {
		url?: string;
		hubName?: string;
		label?: string;
		now?: number;
		maxPlaintextSize?: number;
		/**
		 * Varies the ephemeral keys so the fixture models a genuinely *different*
		 * session. Noise transport keys come from the chaining key, which the
		 * prologue does not feed, so two sessions that differ only in prologue but
		 * reuse ephemerals share transport keys. Real sessions always have fresh
		 * random ephemerals; cross-session tests must pass a distinct seed.
		 */
		seed?: string;
	} = {},
): PairedFixture {
	const now = options.now ?? FIXED_NOW;
	const seed = options.seed ?? "";
	const hubKeyPair = generateDeviceKeyPair(deterministicRandom("hub-static"));
	const deviceKeyPair = generateDeviceKeyPair(
		deterministicRandom("device-static"),
	);

	const { offer, uri } = createPairingOffer({
		hubPublicKey: hubKeyPair.publicKey,
		hubName: options.hubName ?? "test-laptop",
		url: options.url ?? "wss://relay.cline.bot/hub/abc",
		now: () => now,
		random: deterministicRandom(`offer${seed}`),
	});

	// Same clock as the offer, so the session's TTL budget matches its expiry.
	const session = createHubPairingSession(offer, hubKeyPair.privateKey, {
		now: () => now,
	});
	const pending = acceptPairingOffer(uri, deviceKeyPair.privateKey, {
		metadata: { label: options.label ?? "Example's iPhone", platform: "ios" },
		now: () => now,
		random: deterministicRandom(`device-ephemeral${seed}`),
		maxPlaintextSize: options.maxPlaintextSize,
	});
	const completed = session.complete(pending.attestation, {
		now: () => now,
		random: deterministicRandom(`hub-ephemeral${seed}`),
		maxPlaintextSize: options.maxPlaintextSize,
	});
	const finished = pending.complete(completed.response);

	return {
		hubKeyPair,
		deviceKeyPair,
		offer,
		uri,
		hubChannel: completed.channel,
		deviceChannel: finished.channel,
		deviceId: completed.device.deviceId,
		deviceFingerprint: completed.device.fingerprint,
		hubFingerprint: finished.hub.fingerprint,
	};
}

export async function registryWith(
	records: readonly PairedDeviceRecord[] = [],
): Promise<DeviceRegistry> {
	return DeviceRegistry.open(createInMemoryDeviceStore(records), {
		now: () => FIXED_NOW,
	});
}
