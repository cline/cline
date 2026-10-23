/**
 * The hub's side of device pairing: the object that turns a Noise handshake
 * message arriving on a websocket into an authenticated, revocable identity.
 *
 * This is the second authentication path the hub has, alongside the durable
 * `cline-hub-auth.<token>` subprotocol. It exists because a QR that carries the
 * hub token grants full, non-expiring access to the machine and the printed
 * expiry is then a lie. Here, the credential in the QR is a single-use Noise PSK
 * whose expiry the *hub* enforces, and what it buys is an entry in the device
 * allowlist that `cline hub devices revoke` can take away again.
 *
 * Both halves live here rather than in the websocket server so the rules —
 * expiry, single use, allowlist, replay — are testable without a socket.
 *
 * The accepted result retains the Noise `SecureChannel`; the WebSocket boundary
 * uses it to seal every hub frame after the handshake.
 */

import {
	type ApprovalPolicy,
	acceptDeviceSession,
	createHubPairingSession,
	type DeviceKeyPair,
	type DeviceRegistry,
	HubPairingError,
	PairingOfferConsumedError,
	PairingOfferExpiredError,
	type SecureChannel,
	type TerminableChannel,
} from "@cline/hub-pairing";
import { HUB_MAX_FRAME_BYTES } from "@cline/shared";
import {
	deletePairingOffer,
	hubDevicesPath,
	hubIdentityPath,
	hubPairingOffersDir,
	openDeviceRegistry,
	pruneExpiredPairingOffers,
	readHubIdentity,
	readPairingOffer,
} from "./store";

/** Refusal reason for an offer the hub has no usable record of. */
export class PairingOfferUnknownError extends HubPairingError {
	constructor(message = "Pairing offer is unknown, expired, or already used") {
		super("offer_invalid", message);
		this.name = "PairingOfferUnknownError";
	}
}

export class HubPairingUnavailableError extends HubPairingError {
	constructor(
		message = "This machine has no pairing identity yet. Run `cline hub share` on it first.",
	) {
		super("offer_invalid", message);
		this.name = "HubPairingUnavailableError";
	}
}

export interface PairedDeviceAcceptance {
	/** Noise handshake message 2, to be sent back to the device. */
	readonly response: Uint8Array;
	readonly deviceId: string;
	readonly label: string;
	readonly fingerprint: string;
	readonly hubName: string;
	readonly hubPublicKey: Uint8Array;
	readonly approvalPolicy: ApprovalPolicy;
	readonly channel: SecureChannel;
	/** Session the offer asked the device to open, when it named one. */
	readonly sessionId?: string;
	/** Detaches this connection from the registry when it ends. */
	readonly release: () => void;
}

export interface DeviceSessionAcceptance {
	readonly response: Uint8Array;
	readonly deviceId: string;
	readonly label: string;
	readonly fingerprint: string;
	readonly approvalPolicy: ApprovalPolicy;
	readonly channel: SecureChannel;
	readonly release: () => void;
}

export interface HubPairingAuthorityOptions {
	readonly pairingDir?: string;
	readonly identityPath?: string;
	readonly devicesPath?: string;
	readonly offersDir?: string;
	/** Injectable clock. This is the clock that decides whether an offer expired. */
	readonly now?: () => number;
	/** Defense-in-depth when an OS file watcher drops an external revocation. */
	readonly revocationSyncIntervalMs?: number;
}

export interface HubPairingAuthority {
	/** True once this machine has an identity, i.e. pairing is possible at all. */
	isAvailable(): Promise<boolean>;
	/**
	 * Enroll a device from a pairing attestation. Rejects an unknown, expired or
	 * already-used offer, and a message that does not prove possession of the
	 * offer's one-time secret.
	 *
	 * `bind` is the live connection, so revoking the device later closes it.
	 */
	pair(input: {
		offerId: string;
		message: Uint8Array;
		bind: TerminableChannel;
	}): Promise<PairedDeviceAcceptance>;
	/**
	 * Authenticate a device that is already paired. No token, no offer: the
	 * Noise_IK message proves the device key and pins ours, and the registry
	 * decides whether that key is still allowed in.
	 */
	openDeviceSession(input: {
		message: Uint8Array;
		bind: TerminableChannel;
	}): Promise<DeviceSessionAcceptance>;
	close(): Promise<void>;
}

/**
 * A `TerminableChannel` view of a live websocket, so `DeviceRegistry` can drop
 * the connection when the device is revoked in another process.
 */
export function terminableSocket(socket: {
	close(): void;
	isClosed(): boolean;
}): TerminableChannel {
	return {
		get closed() {
			return socket.isClosed();
		},
		close() {
			socket.close();
		},
	};
}

export function createFileHubPairingAuthority(
	options: HubPairingAuthorityOptions = {},
): HubPairingAuthority {
	const now = options.now ?? (() => Date.now());
	const identityPath =
		options.identityPath ?? hubIdentityPath(options.pairingDir);
	const devicesPath = options.devicesPath ?? hubDevicesPath(options.pairingDir);
	const offersDir =
		options.offersDir ?? hubPairingOffersDir(options.pairingDir);

	// Only ever holds a *found* identity. A long-running hub is routinely started
	// before the user first runs `cline hub share`, which is what creates
	// identity.json — caching the absence would make every later pairing on that
	// hub fail until it was restarted.
	let identity: DeviceKeyPair | undefined;
	let registryPromise: Promise<DeviceRegistry> | undefined;
	let stopRevocationWatch: (() => void) | undefined;
	let revocationSyncTimer: ReturnType<typeof setInterval> | undefined;
	// Offer ids this process has already completed. Belt to the file deletion's
	// braces: the file is the durable record, this survives a failed unlink and
	// closes the window between "handshake accepted" and "file gone".
	const consumedOfferIds = new Set<string>();
	// Serialises concurrent sockets presenting the same offer, so two of them
	// cannot both pass the "not yet consumed" check.
	const inFlight = new Map<string, Promise<unknown>>();

	const loadIdentity = async (): Promise<DeviceKeyPair | undefined> => {
		identity ??= await readHubIdentity(identityPath);
		return identity;
	};

	const requireIdentity = async (): Promise<DeviceKeyPair> => {
		const found = await loadIdentity();
		if (!found) {
			throw new HubPairingUnavailableError();
		}
		return found;
	};

	const loadRegistry = async (): Promise<DeviceRegistry> => {
		registryPromise ??= (async () => {
			const registry = await openDeviceRegistry(devicesPath);
			// Revocation is performed by a different process (`cline hub devices
			// revoke` writes devices.json). Watching the file is what makes that
			// revocation reach the sockets this process is holding.
			stopRevocationWatch = registry.startRevocationWatch();
			const intervalMs = options.revocationSyncIntervalMs ?? 30_000;
			if (intervalMs > 0) {
				revocationSyncTimer = setInterval(() => {
					void registry.syncRevocations().catch(() => undefined);
				}, intervalMs);
				revocationSyncTimer.unref?.();
			}
			return registry;
		})();
		return await registryPromise;
	};

	/**
	 * Runs `task` after every earlier task for the same offer id has settled, so
	 * two sockets presenting one offer at the same instant cannot both observe it
	 * as unconsumed. The chain is stored settled-and-swallowed, so one failure
	 * does not reject the next waiter.
	 */
	const serialize = <T>(
		offerId: string,
		task: () => Promise<T>,
	): Promise<T> => {
		const previous = inFlight.get(offerId) ?? Promise.resolve();
		const running = previous.then(task);
		const settled = running.then(
			() => undefined,
			() => undefined,
		);
		inFlight.set(offerId, settled);
		void settled.then(() => {
			if (inFlight.get(offerId) === settled) {
				inFlight.delete(offerId);
			}
		});
		return running;
	};

	return {
		async isAvailable() {
			return (await loadIdentity()) !== undefined;
		},

		async pair({ offerId, message, bind }) {
			const identity = await requireIdentity();
			return await serialize(offerId, async () => {
				if (consumedOfferIds.has(offerId)) {
					throw new PairingOfferConsumedError();
				}
				const offer = await readPairingOffer(offerId, offersDir);
				if (!offer) {
					throw new PairingOfferUnknownError();
				}
				// THE server-side expiry check. The phone checks the same timestamp, but
				// only this one is load-bearing: it is what makes the expiry printed
				// under the QR a fact about the machine rather than a request to the
				// device. `createHubPairingSession` re-checks it (and holds a monotonic
				// budget), so a clock stepped backwards cannot widen the window either.
				if (offer.expiresAt <= now()) {
					await deletePairingOffer(offerId, offersDir).catch(() => undefined);
					throw new PairingOfferExpiredError();
				}
				const session = createHubPairingSession(offer, identity.privateKey, {
					now,
					// The offer was minted in another process, so this process's monotonic
					// clock shares no origin with it; the wall-clock checks above and
					// inside `complete` are the enforcement here.
					monotonic: null,
				});
				const completed = session.complete(
					{ version: offer.version, offerId, message },
					{ now, maxPlaintextSize: HUB_MAX_FRAME_BYTES },
				);
				// Burn the offer the moment a valid attestation is accepted, before the
				// device is told anything, so a captured message 1 cannot enroll twice.
				consumedOfferIds.add(offerId);
				await deletePairingOffer(offerId, offersDir).catch(() => undefined);
				void pruneExpiredPairingOffers(now(), offersDir).catch(() => undefined);

				const registry = await loadRegistry();
				const record = await registry.add({
					publicKey: completed.device.publicKey,
					label: completed.device.label,
					...(completed.device.platform
						? { platform: completed.device.platform }
						: {}),
				});
				const unbind = registry.bindChannel(record.deviceId, bind);
				return {
					response: completed.response.message,
					deviceId: record.deviceId,
					label: record.label,
					fingerprint: completed.device.fingerprint,
					hubName: offer.hubName,
					hubPublicKey: identity.publicKey,
					approvalPolicy: registry.getApprovalPolicy(record.deviceId),
					channel: completed.channel,
					...(offer.sessionId ? { sessionId: offer.sessionId } : {}),
					release: () => {
						unbind();
						completed.channel.close();
					},
				};
			});
		},

		async openDeviceSession({ message, bind }) {
			const identity = await requireIdentity();
			const registry = await loadRegistry();
			// Pick up a revocation written by another process since the last change
			// notification, so a revoked device cannot win a race against the watcher.
			await registry.syncRevocations();
			// Throws DeviceUnknownError / DeviceRevokedError / SessionReplayError.
			const accepted = acceptDeviceSession(
				{
					hubPrivateKey: identity.privateKey,
					registry,
					message,
				},
				{ maxPlaintextSize: HUB_MAX_FRAME_BYTES },
			);
			const unbind = registry.bindChannel(accepted.device.deviceId, bind);
			await registry.touch(accepted.device.deviceId).catch(() => undefined);
			return {
				response: accepted.message,
				deviceId: accepted.device.deviceId,
				label: accepted.device.label,
				fingerprint: registry.fingerprintOf(accepted.device),
				approvalPolicy: accepted.approvalPolicy,
				channel: accepted.channel,
				release: () => {
					unbind();
					accepted.release();
					accepted.channel.close();
				},
			};
		},

		async close() {
			stopRevocationWatch?.();
			stopRevocationWatch = undefined;
			if (revocationSyncTimer) {
				clearInterval(revocationSyncTimer);
				revocationSyncTimer = undefined;
			}
		},
	};
}
