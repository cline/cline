/**
 * Injectable CSPRNG.
 *
 * Defaults to `globalThis.crypto.getRandomValues`, which exists on Node 22
 * (webcrypto global), browsers, and React Native once `react-native-get-random-values`
 * is installed. Tests inject deterministic sources; nothing in this package ever
 * reaches for `node:crypto`.
 */
export type RandomSource = (length: number) => Uint8Array;

export function defaultRandomSource(length: number): Uint8Array {
	const webcrypto = globalThis.crypto;
	if (!webcrypto || typeof webcrypto.getRandomValues !== "function") {
		throw new Error(
			"No CSPRNG available: globalThis.crypto.getRandomValues is missing. " +
				"On React Native import 'react-native-get-random-values' before @cline/hub-pairing, " +
				"or pass an explicit `random` source.",
		);
	}
	return webcrypto.getRandomValues(new Uint8Array(length));
}

/** Wraps a random source so short reads cannot silently weaken a secret. */
export function randomBytes(length: number, random?: RandomSource): Uint8Array {
	const source = random ?? defaultRandomSource;
	const bytes = source(length);
	if (bytes.length !== length) {
		throw new Error(
			`Random source returned ${bytes.length} bytes, expected ${length}`,
		);
	}
	return bytes;
}
