/**
 * The on-disk form of a pending {@link PairingOffer}.
 *
 * The rendezvous between the process that mints an offer (`cline hub share`,
 * `/handoff`) and the process that completes it (the hub daemon) is the
 * `~/.cline/.../hub/pairing/offers/` directory: both run as the same user against
 * the same `~/.cline`, so no IPC is needed. This codec is the format they agree
 * on, and it lives here — beside the offer type itself — so neither side can
 * invent its own spelling.
 *
 * A serialised offer carries the one-time secret in the clear, which is why the
 * writer must create it 0600 inside a 0700 directory. Nothing here does file
 * I/O: this package stays free of node builtins so React Native can use it.
 */

import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";
import { PairingUriError } from "./errors.js";
import { PAIRING_PROTOCOL_VERSION, type PairingOffer } from "./pairing.js";

const KEY_LENGTH = 32;
const SECRET_LENGTH = 32;

export interface StoredPairingOffer {
	readonly version: number;
	readonly offerId: string;
	readonly hubPublicKey: string;
	readonly hubName: string;
	readonly url: string;
	readonly oneTimeSecret: string;
	readonly expiresAt: number;
	readonly sessionId?: string;
}

/** Canonical JSON for an offer file, newline-terminated. */
export function encodeStoredPairingOffer(offer: PairingOffer): string {
	const stored: StoredPairingOffer = {
		version: offer.version,
		offerId: offer.offerId,
		hubPublicKey: bytesToBase64Url(offer.hubPublicKey),
		hubName: offer.hubName,
		url: offer.url,
		oneTimeSecret: bytesToBase64Url(offer.oneTimeSecret),
		expiresAt: offer.expiresAt,
		...(offer.sessionId ? { sessionId: offer.sessionId } : {}),
	};
	return `${JSON.stringify(stored, null, 2)}\n`;
}

/**
 * Parse an offer file. Every field is checked: the file is only as trustworthy
 * as the filesystem, and a short key or a NaN expiry must be a refusal rather
 * than a handshake that fails confusingly later (or an expiry that never fires).
 */
export function decodeStoredPairingOffer(contents: string): PairingOffer {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		throw new PairingUriError(
			`Stored pairing offer is not JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new PairingUriError("Stored pairing offer is not a JSON object");
	}
	const raw = parsed as Record<string, unknown>;
	if (raw.version !== PAIRING_PROTOCOL_VERSION) {
		throw new PairingUriError(
			`Stored pairing offer has unsupported version ${String(raw.version)}`,
		);
	}
	const text = (field: string): string => {
		const value = raw[field];
		if (typeof value !== "string" || value.length === 0) {
			throw new PairingUriError(`Stored pairing offer has no ${field}`);
		}
		return value;
	};
	const bytes = (field: string, length: number): Uint8Array => {
		let decoded: Uint8Array;
		try {
			decoded = base64UrlToBytes(text(field));
		} catch {
			throw new PairingUriError(
				`Stored pairing offer ${field} is not base64url`,
			);
		}
		if (decoded.length !== length) {
			throw new PairingUriError(
				`Stored pairing offer ${field} is ${decoded.length} bytes, expected ${length}`,
			);
		}
		return decoded;
	};
	const expiresAt = raw.expiresAt;
	if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) {
		throw new PairingUriError("Stored pairing offer has no usable expiry");
	}
	const sessionId = raw.sessionId;
	if (
		sessionId !== undefined &&
		(typeof sessionId !== "string" || sessionId.length === 0)
	) {
		throw new PairingUriError("Stored pairing offer has a malformed sessionId");
	}
	return {
		version: PAIRING_PROTOCOL_VERSION,
		offerId: text("offerId"),
		hubPublicKey: bytes("hubPublicKey", KEY_LENGTH),
		hubName: text("hubName"),
		url: text("url"),
		oneTimeSecret: bytes("oneTimeSecret", SECRET_LENGTH),
		expiresAt,
		...(sessionId ? { sessionId } : {}),
	};
}
