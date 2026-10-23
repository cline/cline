/**
 * The QR pairing ceremony and subsequent session establishment.
 *
 * Enrollment uses **Noise_IKpsk1_25519_ChaChaPoly_SHA256**:
 *   - `IK` because the laptop's static public key is printed in the QR, so the
 *     phone knows it before the first byte and the laptop is authenticated by
 *     construction. The phone's static key travels encrypted inside message 1.
 *   - `psk1` because the QR's one-time secret is mixed in at the *end of message
 *     one*, which means the laptop verifies "this peer physically scanned my
 *     screen" the moment it reads that message. A relay or account holder who
 *     never saw the QR cannot produce an acceptable message 1.
 *
 * Reconnection uses **Noise_IK_25519_ChaChaPoly_SHA256** with both static keys
 * pinned: the phone pins the laptop key it stored at pairing, and the laptop
 * looks the phone's key up in its `DeviceRegistry`.
 *
 * The Noise *prologue* binds the protocol version, offer id, hub URL, hub name
 * and expiry. Any of those being altered in flight (a downgrade, a substituted
 * relay URL) changes the prologue on one side only and the handshake fails.
 */
import {
	base64UrlToBytes,
	bytesToBase64Url,
	bytesToUtf8,
	concatBytes,
	lengthPrefixed,
	utf8ToBytes,
} from "./bytes.js";
import { createSecureChannel, type SecureChannel } from "./channel.js";
import {
	AttestationRejectedError,
	HandshakeStateError,
	HubPairingError,
	PairingOfferConsumedError,
	PairingOfferExpiredError,
	PairingUriError,
	ProtocolVersionError,
} from "./errors.js";
import { deviceFingerprint, deviceIdFromPublicKey } from "./keys.js";
import { HandshakeState } from "./noise/handshake-state.js";
import { IK, IKpsk1 } from "./noise/patterns.js";
import { DHLEN, publicKeyFromPrivateKey } from "./noise/primitives.js";
import { type RandomSource, randomBytes } from "./random.js";
import type {
	ApprovalPolicy,
	DeviceRegistry,
	PairedDeviceRecord,
} from "./registry.js";

/** Bumped only for wire-incompatible changes; both sides must agree exactly. */
export const PAIRING_PROTOCOL_VERSION = 1;
export const PAIRING_URI_SCHEME = "cline-pair";
/**
 * Deep-link scheme the mobile app registers. `cline-pair://` predates it and is
 * still emitted by `cline hub pair`, so the decoder accepts both: one QR format
 * for the phone-initiated ceremony, one for machine-initiated handoff.
 */
export const HANDOFF_URI_SCHEME = "clinecode";
export const HANDOFF_URI_HOST = "handoff";
export const DEFAULT_OFFER_TTL_MS = 60_000;
const ONE_TIME_SECRET_LENGTH = 32;
const OFFER_ID_LENGTH = 16;

const PAIRING_PROLOGUE_LABEL = utf8ToBytes("cline-hub-pair/v1");
const SESSION_PROLOGUE_LABEL = utf8ToBytes("cline-hub-session/v1");

export interface PairingOffer {
	readonly version: number;
	readonly offerId: string;
	/** Laptop's long-term X25519 static public key. */
	readonly hubPublicKey: Uint8Array;
	readonly hubName: string;
	/** Websocket URL the phone should connect to (hub or relay). */
	readonly url: string;
	/** High-entropy single-use secret; used as the Noise pre-shared key. */
	readonly oneTimeSecret: Uint8Array;
	/** Epoch milliseconds. */
	readonly expiresAt: number;
	/**
	 * Session the scanning device should open (machine-initiated handoff). Absent
	 * means "no opinion": the device lands in its normal session list.
	 *
	 * Deliberately NOT part of the Noise prologue. The prologue binds what must not
	 * be substituted in flight — the relay URL, the hub key, the expiry — and its
	 * transcript is pinned by test vectors shared with the mobile app. A session id
	 * is a view hint: altering it cannot grant access the paired device does not
	 * already have, since every session still goes through the same authenticated
	 * channel and approval policy.
	 */
	readonly sessionId?: string;
}

/**
 * Hub-side state for an outstanding offer. Holds the laptop private key and the
 * single-use flag, so it must never be logged or serialised.
 */
export interface HubPairingSession {
	readonly offer: PairingOffer;
	readonly consumed: boolean;
	readonly expiresAt: number;
}

export interface PairingAttestation {
	readonly version: number;
	readonly offerId: string;
	/** Noise handshake message 1. Authenticates the device key and QR possession. */
	readonly message: Uint8Array;
}

export interface PairingResponse {
	readonly version: number;
	readonly offerId: string;
	/** Noise handshake message 2. */
	readonly message: Uint8Array;
}

export interface DevicePairingMetadata {
	readonly label: string;
	readonly platform?: string;
}

export interface HubPairingMetadata {
	readonly hubName: string;
}

// ---------------------------------------------------------------------------
// Offer creation + QR encoding
// ---------------------------------------------------------------------------

export interface CreatePairingOfferInput {
	/** Laptop static public key (from its persistent identity file). */
	readonly hubPublicKey: Uint8Array;
	readonly hubName: string;
	readonly url: string;
	readonly ttlMs?: number;
	/** Session the scanning device should open; omit to leave the choice to it. */
	readonly sessionId?: string;
	readonly now?: () => number;
	readonly random?: RandomSource;
}

export interface CreatePairingOfferResult {
	readonly offer: PairingOffer;
	readonly oneTimeSecret: Uint8Array;
	readonly expiresAt: number;
	/** Ready-to-render QR payload. */
	readonly uri: string;
}

export function createPairingOffer(
	input: CreatePairingOfferInput,
): CreatePairingOfferResult {
	if (input.hubPublicKey.length !== DHLEN) {
		throw new HandshakeStateError(
			`hubPublicKey must be ${DHLEN} bytes, got ${input.hubPublicKey.length}`,
		);
	}
	const now = input.now?.() ?? Date.now();
	const ttlMs = input.ttlMs ?? DEFAULT_OFFER_TTL_MS;
	if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
		throw new PairingUriError("Pairing offer TTL must be a positive integer");
	}
	const oneTimeSecret = randomBytes(ONE_TIME_SECRET_LENGTH, input.random);
	const offerId = bytesToBase64Url(randomBytes(OFFER_ID_LENGTH, input.random));
	const expiresAt = now + ttlMs;
	if (!Number.isSafeInteger(expiresAt)) {
		throw new PairingUriError("Pairing offer expiry is outside the safe range");
	}
	const offer: PairingOffer = {
		version: PAIRING_PROTOCOL_VERSION,
		offerId,
		hubPublicKey: input.hubPublicKey.slice(),
		hubName: input.hubName,
		url: input.url,
		oneTimeSecret,
		expiresAt,
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
	};
	return { offer, oneTimeSecret, expiresAt, uri: encodePairingUri(offer) };
}

export interface CreateHubPairingSessionOptions {
	/**
	 * Clock used to snapshot how much of the offer's TTL is left, and the default
	 * clock for `complete`. Must be the SAME clock `createPairingOffer` used, or
	 * the offer's expiry and this session's idea of "expired" will disagree.
	 */
	readonly now?: () => number;
	/**
	 * Monotonic millisecond source, used to enforce the TTL independently of the
	 * wall clock. Defaults to `performance.now()` where available; pass `null` to
	 * opt out (tests, or a platform without one).
	 */
	readonly monotonic?: (() => number) | null;
}

function defaultMonotonic(): (() => number) | undefined {
	const perf = (globalThis as { performance?: { now?: () => number } })
		.performance;
	return typeof perf?.now === "function" ? () => perf.now?.() ?? 0 : undefined;
}

/**
 * Hub-side companion to an offer. Kept separate from `PairingOffer` so the
 * public offer (which is what goes in the QR) never carries the private key.
 *
 * Offer expiry is enforced on two clocks. The wall clock is authoritative
 * because `expiresAt` is an absolute timestamp that has to be meaningful to the
 * phone, which only ever sees the URI — there is no monotonic clock shared
 * across the QR boundary, so the *device* side can only ever do a wall-clock
 * check, and a device with a badly wrong clock is a limitation we accept. On the
 * hub side, where the offer is minted and consumed in one process, we also
 * snapshot a monotonic reading and refuse an attestation once the monotonic
 * elapsed time exceeds the TTL budget, so stepping the laptop's wall clock
 * backwards cannot extend a pairing window.
 */
export function createHubPairingSession(
	offer: PairingOffer,
	hubPrivateKey: Uint8Array,
	sessionOptions: CreateHubPairingSessionOptions = {},
): HubPairingSession & {
	complete(
		attestation: PairingAttestation,
		options?: CompletePairingOptions,
	): CompletePairingResult;
} {
	let consumed = false;
	const wallNow = sessionOptions.now ?? (() => Date.now());
	const monotonic =
		sessionOptions.monotonic === null
			? undefined
			: (sessionOptions.monotonic ?? defaultMonotonic());
	const budgetMs = offer.expiresAt - wallNow();
	// A non-positive budget means this clock cannot be the one that minted the
	// offer (or the offer is already dead, which the wall-clock check below
	// refuses anyway), so there is no meaningful TTL to hold a monotonic clock to.
	const startedMonotonic = budgetMs > 0 ? monotonic?.() : undefined;
	const session = {
		offer,
		expiresAt: offer.expiresAt,
		get consumed() {
			return consumed;
		},
		complete(
			attestation: PairingAttestation,
			options: CompletePairingOptions = {},
		): CompletePairingResult {
			if (consumed) {
				throw new PairingOfferConsumedError();
			}
			const now = options.now?.() ?? wallNow();
			if (now > offer.expiresAt) {
				throw new PairingOfferExpiredError();
			}
			if (
				startedMonotonic !== undefined &&
				monotonic !== undefined &&
				monotonic() - startedMonotonic > budgetMs
			) {
				// The wall clock says we are still inside the window; the monotonic clock
				// says otherwise, so the wall clock moved backwards.
				throw new PairingOfferExpiredError(
					"Pairing offer has expired (monotonic TTL exceeded)",
				);
			}
			if (attestation.version !== PAIRING_PROTOCOL_VERSION) {
				throw new ProtocolVersionError(
					`Unsupported pairing protocol version ${attestation.version}; expected ${PAIRING_PROTOCOL_VERSION}`,
				);
			}
			if (attestation.offerId !== offer.offerId) {
				throw new AttestationRejectedError("Attestation is for another offer");
			}

			const handshake = new HandshakeState({
				pattern: IKpsk1,
				initiator: false,
				prologue: buildPairingPrologue(offer),
				staticKeyPair:
					HandshakeState.staticKeyPairFromPrivateKey(hubPrivateKey),
				psk: offer.oneTimeSecret,
				random: options.random,
			});

			let devicePayload: Uint8Array;
			try {
				devicePayload = handshake.readMessage(attestation.message).payload;
			} catch (error) {
				// Any failure here means the peer did not hold the QR secret, did not
				// know our static key, or tampered with the message. Collapse them all
				// into one opaque rejection.
				if (
					error instanceof HubPairingError &&
					error.code === "handshake_state"
				) {
					throw error;
				}
				throw new AttestationRejectedError();
			}
			// Burn the offer as soon as a *valid* attestation is seen, so a captured
			// message 1 cannot be replayed to enroll a second device.
			consumed = true;

			const metadata = parseJsonPayload<DevicePairingMetadata>(devicePayload);
			const written = handshake.writeMessage(
				encodeJsonPayload<HubPairingMetadata>({ hubName: offer.hubName }),
			);
			const result = written.result;
			if (!result) {
				throw new HandshakeStateError("Pairing handshake did not complete");
			}

			const devicePublicKey = result.remoteStaticPublicKey;
			const channel = createSecureChannel({
				sendKey: result.sendKey,
				recvKey: result.recvKey,
				role: "hub",
				handshakeHash: result.handshakeHash,
				peerPublicKey: devicePublicKey,
				maxPlaintextSize: options.maxPlaintextSize,
			});

			return {
				response: {
					version: PAIRING_PROTOCOL_VERSION,
					offerId: offer.offerId,
					message: written.message,
				},
				device: {
					deviceId: deviceIdFromPublicKey(devicePublicKey),
					publicKey: devicePublicKey,
					fingerprint: deviceFingerprint(devicePublicKey),
					label: metadata?.label ?? "Unnamed device",
					platform: metadata?.platform,
				},
				channel,
				handshakeHash: result.handshakeHash,
			};
		},
	};
	return session;
}

/**
 * `"pair"` is the original `cline-pair://v1?…` QR the phone-initiated ceremony
 * uses. `"handoff"` is the `clinecode://handoff?…` deep link a machine emits when
 * the user walks away from the keyboard.
 */
export type PairingUriFormat = "pair" | "handoff";

const HANDOFF_NOT_AN_OFFER =
	"This handoff link carries a hub credential, not a pairing offer; decode it with decodeHandoffUri";

export interface EncodePairingUriOptions {
	readonly format?: PairingUriFormat;
}

/**
 * A machine-initiated handoff link — the shared wire contract with the mobile app.
 *
 * ```
 * clinecode://handoff
 *   ?v=1                     protocol version, refused rather than guessed
 *   &k=<base64url>           hub static public key (32 bytes)
 *   &s=<credential>          see `credential` below
 *   &u=<base64url>           hub websocket url
 *   &n=<name>                machine display name
 *   &e=<epoch ms>            expiry
 *   [&sid=<hub session id>]  optional: session to open on arrival
 *   [&i=<offer id>]          only on relay-era links minted from a pairing offer
 * ```
 *
 * The url is base64url so the payload carries no nested percent-encoding for a QR
 * scanner or a deep-link router to mangle.
 */
export interface HandoffLink {
	readonly version: number;
	/**
	 * Hub static public key. **Reserved**: it exists so the QR shape does not change
	 * when the Noise pairing ceremony reaches the phone. The v1 mobile app validates
	 * its size and then drops it — it performs no handshake.
	 */
	readonly hubPublicKey: Uint8Array;
	readonly hubName: string;
	readonly url: string;
	/**
	 * The credential the phone presents to the hub, used verbatim (it is never
	 * re-encoded, so it must be URL-safe as written).
	 *
	 * In v1 this is the hub's **own auth token** — the same root-equivalent
	 * credential the manual "url + token" form pastes today — because the phone
	 * speaks `cline-hub-auth.<token>` and cannot run the pairing handshake yet.
	 * Consequences, stated rather than implied:
	 *   - the link grants full hub access for as long as that token is valid;
	 *   - `expiresAt` is therefore *advisory*: the phone refuses an expired link,
	 *     but the hub has nothing to expire.
	 * Once a relay is in the path this becomes a one-time Noise pre-shared secret
	 * (`bytesToBase64Url(offer.oneTimeSecret)`), which is what makes an intercepted
	 * link worthless. That is the whole point of keeping `k` in the URI.
	 */
	readonly credential: string;
	/** Epoch milliseconds. Advisory while `credential` is a hub token. */
	readonly expiresAt: number;
	/** Session the phone should open; absent means "phone chooses". */
	readonly sessionId?: string;
	/** Present only on links minted from a pairing offer. */
	readonly offerId?: string;
}

/**
 * Percent-encoding with `%20` for spaces rather than `+`. Deep-link routers that
 * re-join a query from already-decoded values turn a literal `+` into a space, so
 * `+` must never be produced by us.
 */
function encodeHandoffParam(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export function encodeHandoffUri(link: HandoffLink): string {
	const parts = [
		`v=${link.version}`,
		...(link.offerId ? [`i=${encodeHandoffParam(link.offerId)}`] : []),
		`k=${encodeHandoffParam(bytesToBase64Url(link.hubPublicKey))}`,
		`s=${encodeHandoffParam(link.credential)}`,
		`u=${encodeHandoffParam(bytesToBase64Url(utf8ToBytes(link.url)))}`,
		`n=${encodeHandoffParam(link.hubName)}`,
		`e=${link.expiresAt}`,
		...(link.sessionId ? [`sid=${encodeHandoffParam(link.sessionId)}`] : []),
	];
	return `${HANDOFF_URI_SCHEME}://${HANDOFF_URI_HOST}?${parts.join("&")}`;
}

export function decodeHandoffUri(uri: string): HandoffLink {
	const envelope = readUriEnvelope(uri);
	if (envelope.format !== "handoff") {
		throw new PairingUriError(`Not a ${HANDOFF_URI_SCHEME} handoff link`);
	}
	const { version, params } = envelope;
	if (version !== PAIRING_PROTOCOL_VERSION) {
		throw new ProtocolVersionError(
			`Unsupported handoff version ${version}; expected ${PAIRING_PROTOCOL_VERSION}`,
		);
	}
	const hubPublicKeyText = params.get("k");
	const credential = params.get("s");
	const urlText = params.get("u");
	const hubName = params.get("n");
	const expiresAtText = params.get("e");
	if (
		!hubPublicKeyText ||
		!credential ||
		!urlText ||
		!hubName ||
		!expiresAtText
	) {
		throw new PairingUriError("Handoff link is missing required fields");
	}
	let hubPublicKey: Uint8Array;
	let url: string;
	try {
		hubPublicKey = base64UrlToBytes(hubPublicKeyText);
		url = bytesToUtf8(base64UrlToBytes(urlText));
	} catch (error) {
		throw new PairingUriError(
			`Handoff link contains malformed base64url: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (hubPublicKey.length !== DHLEN) {
		throw new PairingUriError(
			`Hub public key must be ${DHLEN} bytes, got ${hubPublicKey.length}`,
		);
	}
	if (!/^\d+$/.test(expiresAtText)) {
		throw new PairingUriError("Handoff link has a malformed expiry");
	}
	const expiresAt = Number(expiresAtText);
	if (!Number.isSafeInteger(expiresAt)) {
		throw new PairingUriError("Handoff link has a malformed expiry");
	}
	const sessionId = params.get("sid")?.trim();
	const offerId = params.get("i")?.trim();
	return {
		version,
		hubPublicKey,
		hubName,
		url,
		credential,
		expiresAt,
		...(sessionId ? { sessionId } : {}),
		...(offerId ? { offerId } : {}),
	};
}

/**
 * Encodes a pairing offer. `format: "handoff"` emits the relay-era handoff link:
 * same URI shape as the v1 link the CLI mints, with the one-time Noise secret in
 * `s` instead of a hub token.
 */
export function encodePairingUri(
	offer: PairingOffer,
	options: EncodePairingUriOptions = {},
): string {
	if (options.format === "handoff") {
		return encodeHandoffUri({
			version: offer.version,
			offerId: offer.offerId,
			hubPublicKey: offer.hubPublicKey,
			hubName: offer.hubName,
			url: offer.url,
			credential: bytesToBase64Url(offer.oneTimeSecret),
			expiresAt: offer.expiresAt,
			...(offer.sessionId ? { sessionId: offer.sessionId } : {}),
		});
	}
	const params = new URLSearchParams();
	params.set("i", offer.offerId);
	params.set("k", bytesToBase64Url(offer.hubPublicKey));
	params.set("s", bytesToBase64Url(offer.oneTimeSecret));
	params.set("u", offer.url);
	params.set("n", offer.hubName);
	params.set("e", String(offer.expiresAt));
	if (offer.sessionId) {
		params.set("sid", offer.sessionId);
	}
	return `${PAIRING_URI_SCHEME}://v${offer.version}?${params.toString()}`;
}

/**
 * Splits a URI into its authority and query and reads the protocol version from
 * wherever that scheme keeps it: in the authority for `cline-pair://v1`, in a `v`
 * query param for `clinecode://handoff`.
 */
function readUriEnvelope(uri: string): {
	format: PairingUriFormat;
	version: number;
	params: URLSearchParams;
} {
	const match = /^([a-z][a-z0-9+.-]*):\/\/([^?]*)\?(.*)$/.exec(uri.trim());
	if (!match) {
		throw new PairingUriError("Not a Cline pairing URI");
	}
	const [, scheme, authority, query] = match;
	const params = new URLSearchParams(query);
	if (scheme === HANDOFF_URI_SCHEME) {
		if (authority !== HANDOFF_URI_HOST) {
			throw new PairingUriError(
				`Unexpected ${HANDOFF_URI_SCHEME} link: ${authority}`,
			);
		}
		const versionText = params.get("v");
		if (!versionText) {
			throw new PairingUriError("Handoff URI is missing its version");
		}
		if (!/^\d+$/.test(versionText)) {
			throw new PairingUriError("Handoff URI has a malformed version");
		}
		return {
			format: "handoff",
			version: Number(versionText),
			params,
		};
	}
	if (scheme !== PAIRING_URI_SCHEME) {
		throw new PairingUriError(`Unexpected URI scheme: ${scheme}`);
	}
	const authorityMatch = /^v(\d+)$/.exec(authority ?? "");
	if (!authorityMatch) {
		throw new PairingUriError("Not a Cline pairing URI");
	}
	return {
		format: "pair",
		version: Number.parseInt(authorityMatch[1] as string, 10),
		params,
	};
}

export function decodePairingUri(uri: string): PairingOffer {
	const { format, version, params } = readUriEnvelope(uri);
	if (version !== PAIRING_PROTOCOL_VERSION) {
		// Explicit refusal rather than best-effort parsing: an attacker must not be
		// able to talk us down to an older ceremony.
		throw new ProtocolVersionError(
			`Unsupported pairing protocol version ${version}; expected ${PAIRING_PROTOCOL_VERSION}`,
		);
	}

	const offerId = params.get("i");
	const hubPublicKeyText = params.get("k");
	const secretText = params.get("s");
	const urlText = params.get("u");
	const hubName = params.get("n");
	const expiresAtText = params.get("e");
	if (format === "handoff" && !offerId) {
		// A v1 handoff link carries the hub's own auth token in `s` and no offer at
		// all. Say that, rather than reporting a missing field.
		throw new PairingUriError(HANDOFF_NOT_AN_OFFER);
	}
	if (
		!offerId ||
		!hubPublicKeyText ||
		!secretText ||
		!urlText ||
		!hubName ||
		!expiresAtText
	) {
		throw new PairingUriError("Pairing URI is missing required fields");
	}

	let hubPublicKey: Uint8Array;
	let oneTimeSecret: Uint8Array;
	let url: string;
	try {
		hubPublicKey = base64UrlToBytes(hubPublicKeyText);
		oneTimeSecret = base64UrlToBytes(secretText);
		url =
			format === "handoff" ? bytesToUtf8(base64UrlToBytes(urlText)) : urlText;
	} catch (error) {
		throw new PairingUriError(
			`Pairing URI contains malformed base64url: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (hubPublicKey.length !== DHLEN) {
		throw new PairingUriError(
			`Hub public key must be ${DHLEN} bytes, got ${hubPublicKey.length}`,
		);
	}
	if (oneTimeSecret.length !== ONE_TIME_SECRET_LENGTH) {
		if (format === "handoff") {
			throw new PairingUriError(HANDOFF_NOT_AN_OFFER);
		}
		throw new PairingUriError(
			`One-time secret must be ${ONE_TIME_SECRET_LENGTH} bytes, got ${oneTimeSecret.length}`,
		);
	}
	if (!/^\d+$/.test(expiresAtText)) {
		throw new PairingUriError("Pairing URI has a malformed expiry");
	}
	const expiresAt = Number(expiresAtText);
	if (!Number.isSafeInteger(expiresAt)) {
		throw new PairingUriError("Pairing URI has a malformed expiry");
	}

	const sessionId = params.get("sid")?.trim();
	return {
		version,
		offerId,
		hubPublicKey,
		hubName,
		url,
		oneTimeSecret,
		expiresAt,
		...(sessionId ? { sessionId } : {}),
	};
}

/**
 * Canonical, length-prefixed transcript context. Both sides compute this from
 * the offer; a mismatch in any field makes the handshake fail rather than
 * silently proceeding on different assumptions.
 */
export function buildPairingPrologue(offer: PairingOffer): Uint8Array {
	return concatBytes(
		PAIRING_PROLOGUE_LABEL,
		lengthPrefixed(utf8ToBytes(String(offer.version))),
		lengthPrefixed(utf8ToBytes(offer.offerId)),
		lengthPrefixed(utf8ToBytes(offer.url)),
		lengthPrefixed(utf8ToBytes(offer.hubName)),
		lengthPrefixed(utf8ToBytes(String(offer.expiresAt))),
		lengthPrefixed(offer.hubPublicKey),
	);
}

/**
 * Reconnection transcript context. Binds the protocol version and the laptop's
 * static key. The *device* key is deliberately absent: it is transmitted inside
 * message 1 and authenticated by the `se`/`ss` DH operations, so including it
 * here would only force the hub to guess which device is calling before it can
 * even parse the message.
 */
export function buildSessionPrologue(input: {
	hubPublicKey: Uint8Array;
}): Uint8Array {
	return concatBytes(
		SESSION_PROLOGUE_LABEL,
		lengthPrefixed(utf8ToBytes(String(PAIRING_PROTOCOL_VERSION))),
		lengthPrefixed(input.hubPublicKey),
	);
}

// ---------------------------------------------------------------------------
// Phone side: accept an offer
// ---------------------------------------------------------------------------

export interface AcceptPairingOfferOptions {
	readonly metadata?: DevicePairingMetadata;
	readonly now?: () => number;
	readonly random?: RandomSource;
	readonly maxPlaintextSize?: number;
}

export interface PairedHubIdentity {
	readonly publicKey: Uint8Array;
	readonly fingerprint: string;
	readonly hubName: string;
	readonly url: string;
}

export interface PendingPairing {
	readonly attestation: PairingAttestation;
	/** Feed the hub's response to finish; yields the pinned hub key and channel. */
	complete(response: PairingResponse | Uint8Array): {
		hub: PairedHubIdentity;
		channel: SecureChannel;
		handshakeHash: Uint8Array;
	};
}

export function acceptPairingOffer(
	uriOrOffer: string | PairingOffer,
	devicePrivateKey: Uint8Array,
	options: AcceptPairingOfferOptions = {},
): PendingPairing {
	const offer =
		typeof uriOrOffer === "string" ? decodePairingUri(uriOrOffer) : uriOrOffer;
	if (offer.version !== PAIRING_PROTOCOL_VERSION) {
		throw new ProtocolVersionError(
			`Unsupported pairing protocol version ${offer.version}; expected ${PAIRING_PROTOCOL_VERSION}`,
		);
	}
	const now = options.now?.() ?? Date.now();
	if (now > offer.expiresAt) {
		throw new PairingOfferExpiredError();
	}

	const handshake = new HandshakeState({
		pattern: IKpsk1,
		initiator: true,
		prologue: buildPairingPrologue(offer),
		staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(devicePrivateKey),
		remoteStaticPublicKey: offer.hubPublicKey,
		psk: offer.oneTimeSecret,
		random: options.random,
	});

	const metadata: DevicePairingMetadata = options.metadata ?? {
		label: "Unnamed device",
	};
	const written = handshake.writeMessage(
		encodeJsonPayload<DevicePairingMetadata>(metadata),
	);

	return {
		attestation: {
			version: PAIRING_PROTOCOL_VERSION,
			offerId: offer.offerId,
			message: written.message,
		},
		complete(response) {
			const message =
				response instanceof Uint8Array ? response : response.message;
			if (!(response instanceof Uint8Array)) {
				if (response.offerId !== offer.offerId) {
					throw new AttestationRejectedError("Response is for another offer");
				}
				if (response.version !== PAIRING_PROTOCOL_VERSION) {
					throw new ProtocolVersionError(
						`Unsupported pairing protocol version ${response.version}`,
					);
				}
			}
			let read: ReturnType<HandshakeState["readMessage"]>;
			try {
				read = handshake.readMessage(message);
			} catch (error) {
				if (
					error instanceof HubPairingError &&
					error.code === "handshake_state"
				) {
					throw error;
				}
				throw new AttestationRejectedError();
			}
			const result = read.result;
			if (!result) {
				throw new HandshakeStateError("Pairing handshake did not complete");
			}
			const hubMetadata = parseJsonPayload<HubPairingMetadata>(read.payload);
			const channel = createSecureChannel({
				sendKey: result.sendKey,
				recvKey: result.recvKey,
				role: "device",
				handshakeHash: result.handshakeHash,
				peerPublicKey: result.remoteStaticPublicKey,
				maxPlaintextSize: options.maxPlaintextSize,
			});
			return {
				hub: {
					publicKey: result.remoteStaticPublicKey,
					fingerprint: deviceFingerprint(result.remoteStaticPublicKey),
					hubName: hubMetadata?.hubName ?? offer.hubName,
					url: offer.url,
				},
				channel,
				handshakeHash: result.handshakeHash,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Hub side: complete pairing
// ---------------------------------------------------------------------------

export interface CompletePairingOptions {
	readonly now?: () => number;
	readonly random?: RandomSource;
	readonly maxPlaintextSize?: number;
}

export interface PairedDeviceIdentity {
	readonly deviceId: string;
	readonly publicKey: Uint8Array;
	readonly fingerprint: string;
	readonly label: string;
	readonly platform?: string;
}

export interface CompletePairingResult {
	readonly response: PairingResponse;
	readonly device: PairedDeviceIdentity;
	readonly channel: SecureChannel;
	readonly handshakeHash: Uint8Array;
}

/**
 * Hub side of the ceremony. `session` comes from `createHubPairingSession` and
 * carries the laptop private key plus the single-use flag.
 */
export function completePairing(
	session: ReturnType<typeof createHubPairingSession>,
	attestation: PairingAttestation,
	options: CompletePairingOptions = {},
): CompletePairingResult {
	return session.complete(attestation, options);
}

// ---------------------------------------------------------------------------
// Reconnection (every connection after pairing)
// ---------------------------------------------------------------------------

export interface StartDeviceSessionOptions {
	readonly random?: RandomSource;
	readonly maxPlaintextSize?: number;
}

export interface PendingDeviceSession {
	readonly message: Uint8Array;
	complete(response: Uint8Array): {
		channel: SecureChannel;
		handshakeHash: Uint8Array;
	};
}

/**
 * Phone side of a reconnection. Uses the *pinned* hub key stored at pairing, so
 * a relay that answers with a different static key is rejected.
 */
export function startDeviceSession(
	input: {
		devicePrivateKey: Uint8Array;
		hubPublicKey: Uint8Array;
	},
	options: StartDeviceSessionOptions = {},
): PendingDeviceSession {
	const handshake = new HandshakeState({
		pattern: IK,
		initiator: true,
		prologue: buildSessionPrologue({ hubPublicKey: input.hubPublicKey }),
		staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
			input.devicePrivateKey,
		),
		remoteStaticPublicKey: input.hubPublicKey,
		random: options.random,
	});
	const written = handshake.writeMessage();
	return {
		message: written.message,
		complete(response) {
			let read: ReturnType<HandshakeState["readMessage"]>;
			try {
				read = handshake.readMessage(response);
			} catch (error) {
				if (
					error instanceof HubPairingError &&
					error.code === "handshake_state"
				) {
					throw error;
				}
				throw new AttestationRejectedError();
			}
			const result = read.result;
			if (!result) {
				throw new HandshakeStateError("Session handshake did not complete");
			}
			return {
				channel: createSecureChannel({
					sendKey: result.sendKey,
					recvKey: result.recvKey,
					role: "device",
					handshakeHash: result.handshakeHash,
					peerPublicKey: result.remoteStaticPublicKey,
					maxPlaintextSize: options.maxPlaintextSize,
				}),
				handshakeHash: result.handshakeHash,
			};
		},
	};
}

export interface AcceptDeviceSessionOptions {
	readonly random?: RandomSource;
	readonly maxPlaintextSize?: number;
}

export interface AcceptedDeviceSession {
	readonly message: Uint8Array;
	readonly device: PairedDeviceRecord;
	readonly channel: SecureChannel;
	readonly handshakeHash: Uint8Array;
	/** Effective per-device tiered policy, resolved by the registry. */
	readonly approvalPolicy: ApprovalPolicy;
	/**
	 * Detaches the channel from the registry on a clean disconnect. The channel is
	 * bound automatically, so revocation reaches it whether or not the caller
	 * remembers to do anything; call this (and `channel.close()`) when the session
	 * ends normally so the registry stops holding a dead channel.
	 */
	readonly release: () => void;
}

/**
 * Hub side of a reconnection. Authorises against the registry *before* returning
 * a usable channel, so an unknown or revoked device never gets one — this is the
 * check that makes a relay account token insufficient on its own.
 *
 * The returned channel is registered with the registry that authorised it, so
 * `registry.revoke` / `registry.syncRevocations` can terminate it mid-flight.
 * Binding happens here rather than in the caller because this is the only place
 * that provably holds both halves.
 */
export function acceptDeviceSession(
	input: {
		hubPrivateKey: Uint8Array;
		registry: DeviceRegistry;
		message: Uint8Array;
	},
	options: AcceptDeviceSessionOptions = {},
): AcceptedDeviceSession {
	const hubPublicKey = publicKeyFromPrivateKey(input.hubPrivateKey);
	const handshake = new HandshakeState({
		pattern: IK,
		initiator: false,
		prologue: buildSessionPrologue({ hubPublicKey }),
		staticKeyPair: HandshakeState.staticKeyPairFromPrivateKey(
			input.hubPrivateKey,
		),
		random: options.random,
	});

	// Reading message 1 proves the caller holds the device private key AND was
	// able to do `es`/`ss` against our real static key. Only after that do we ask
	// whether the device is *allowed* in.
	let read: ReturnType<HandshakeState["readMessage"]>;
	try {
		read = handshake.readMessage(input.message);
	} catch (error) {
		if (error instanceof HubPairingError && error.code === "handshake_state") {
			throw error;
		}
		throw new AttestationRejectedError();
	}
	void read;

	const devicePublicKey = handshake.peerStaticPublicKey;
	if (!devicePublicKey) {
		throw new AttestationRejectedError();
	}
	// Throws DeviceUnknownError / DeviceRevokedError. Authentication alone is
	// never enough: the key must still be in the allowlist.
	const authorized = input.registry.assertPublicKeyAuthorized(devicePublicKey);
	// Throws SessionReplayError if this exact message 1 was already accepted, so a
	// relay cannot mint hub-side sessions by resending a captured one.
	input.registry.assertFreshSessionHandshake(input.message);

	const written = handshake.writeMessage();
	const result = written.result;
	if (!result) {
		throw new HandshakeStateError("Session handshake did not complete");
	}
	const channel = createSecureChannel({
		sendKey: result.sendKey,
		recvKey: result.recvKey,
		role: "hub",
		handshakeHash: result.handshakeHash,
		peerPublicKey: result.remoteStaticPublicKey,
		maxPlaintextSize: options.maxPlaintextSize,
	});
	// Bind before returning: from this point on the registry can kill the session.
	const release = input.registry.bindChannel(authorized.deviceId, channel);
	return {
		message: written.message,
		device: authorized,
		channel,
		handshakeHash: result.handshakeHash,
		approvalPolicy: input.registry.getApprovalPolicy(authorized.deviceId),
		release,
	};
}

// ---------------------------------------------------------------------------

function encodeJsonPayload<T>(value: T): Uint8Array {
	return utf8ToBytes(JSON.stringify(value));
}

function parseJsonPayload<T>(payload: Uint8Array): T | undefined {
	if (payload.length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(bytesToUtf8(payload)) as T;
	} catch {
		return undefined;
	}
}
