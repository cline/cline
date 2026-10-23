/**
 * The on-disk pairing rendezvous under `~/.cline/.../hub/pairing/`.
 *
 * ```
 * hub/pairing/identity.json          the laptop's X25519 static key (0600)
 * hub/pairing/devices.json           the paired-device allowlist + revocations
 * hub/pairing/offers/<id>.offer.json a pending, single-use pairing offer
 * ```
 *
 * This lives in `@cline/core` rather than in the CLI because the two processes
 * that use it are the CLI (which mints offers and manages devices) and the hub
 * daemon (whose entrypoint is `@cline/core/hub/daemon-entry`, spawned detached).
 * They run as the same user against the same `~/.cline`, so the directory *is*
 * the IPC — but only if both sides agree byte-for-byte on the format, which they
 * can only do by sharing this module. An earlier split of these helpers across
 * packages is what let the CLI and the hub drift.
 *
 * Everything written here is root-equivalent or single-use-secret material:
 * directories are 0700 and files 0600, re-applied on every write so a tree
 * created by an older version is tightened rather than trusted.
 */

import { watch } from "node:fs";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	type ApprovalPolicy,
	assertRecordSelfConsistent,
	base64UrlToBytes,
	type DeviceKeyPair,
	DeviceRegistry,
	type DeviceStore,
	decodeStoredPairingOffer,
	encodePublicKey,
	encodeStoredPairingOffer,
	generateDeviceKeyPair,
	isValidOfferId,
	normalizeApprovalPolicy,
	type PairedDeviceRecord,
	type PairingOffer,
	publicKeyFromPrivateKey,
	STRICTEST_APPROVAL_POLICY,
} from "@cline/hub-pairing";
import { resolveClineDataDir } from "@cline/shared/storage";

interface HubIdentityFile {
	privateKey: string;
	publicKey: string;
	createdAt: string;
}

export function resolveHubPairingDir(): string {
	return join(resolveClineDataDir(), "hub", "pairing");
}

export function hubIdentityPath(dir = resolveHubPairingDir()): string {
	return join(dir, "identity.json");
}

export function hubDevicesPath(dir = resolveHubPairingDir()): string {
	return join(dir, "devices.json");
}

export function hubPairingOffersDir(dir = resolveHubPairingDir()): string {
	return join(dir, "offers");
}

function isMissingFile(error: unknown): boolean {
	return (error as { code?: string } | undefined)?.code === "ENOENT";
}

/**
 * Creates a directory tree that only this user can traverse. `mkdir` with
 * `recursive` alone leaves 0755 directories, which exposes offer ids and device
 * file names to every other local account, so the mode is set explicitly and
 * re-applied to any level that already existed from an earlier version.
 */
export async function ensurePrivateDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const root = resolveClineDataDir();
	let current = path;
	while (current.startsWith(root) && current !== root) {
		await chmod(current, 0o700);
		current = dirname(current);
	}
}

export async function writePrivateFile(
	path: string,
	contents: string,
): Promise<void> {
	await ensurePrivateDir(dirname(path));
	await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
}

/**
 * Loads the laptop identity key, generating and persisting one ONLY when the file
 * is genuinely absent.
 *
 * Any other failure — malformed JSON, a truncated write, a wrong-length key, a
 * permissions problem — is reported. Generating a fresh key in those cases would
 * silently rotate a root-equivalent identity and invalidate the pinned hub key on
 * every paired device, which is unrecoverable without re-pairing them all.
 */
export async function loadOrCreateHubIdentity(
	path = hubIdentityPath(),
): Promise<DeviceKeyPair> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch (error) {
		if (!isMissingFile(error)) {
			throw new Error(
				`Cannot read the hub identity at ${path}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		const keyPair = generateDeviceKeyPair();
		await writePrivateFile(
			path,
			`${JSON.stringify(
				{
					privateKey: encodePublicKey(keyPair.privateKey),
					publicKey: encodePublicKey(keyPair.publicKey),
					createdAt: new Date().toISOString(),
				} satisfies HubIdentityFile,
				null,
				2,
			)}\n`,
		);
		return keyPair;
	}

	try {
		const parsed = JSON.parse(contents) as HubIdentityFile;
		const privateKey = base64UrlToBytes(parsed.privateKey);
		if (privateKey.length !== 32) {
			throw new Error(`key is ${privateKey.length} bytes, expected 32`);
		}
		// Derive rather than trust the stored public half, so a corrupted or edited
		// file cannot make us advertise a key we do not hold.
		return { privateKey, publicKey: publicKeyFromPrivateKey(privateKey) };
	} catch (error) {
		throw new Error(
			`The hub identity at ${path} is damaged (${
				error instanceof Error ? error.message : String(error)
			}). It has NOT been replaced: rotating this key would invalidate every paired device. Restore the file from a backup, or delete it and re-pair your devices.`,
		);
	}
}

/**
 * Reads the identity WITHOUT creating one.
 *
 * The hub daemon uses this: an absent identity means nobody has ever paired a
 * device on this machine, and the hub answering pairing sockets with a key it
 * minted itself would create an identity no `cline hub` command knows about.
 */
export async function readHubIdentity(
	path = hubIdentityPath(),
): Promise<DeviceKeyPair | undefined> {
	try {
		await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFile(error)) {
			return undefined;
		}
		throw error;
	}
	return await loadOrCreateHubIdentity(path);
}

/**
 * Validates one persisted record. A device store is attacker-reachable (it is
 * just a file), so nothing in it is trusted: fields are type-checked, the id is
 * checked against the public key it claims, and a policy that is not a complete,
 * well-formed policy collapses to the strictest one rather than being passed
 * through.
 */
function parseDeviceRecord(value: unknown, index: number): PairedDeviceRecord {
	const fail = (reason: string): never => {
		throw new Error(`record ${index} ${reason}`);
	};
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail("is not an object");
	}
	const raw = value as Record<string, unknown>;
	const requireString = (field: string): string => {
		const found = raw[field];
		if (typeof found !== "string" || found.length === 0) {
			return fail(`has a non-string ${field}`);
		}
		return found;
	};
	const optionalString = (field: string): string | undefined => {
		const found = raw[field];
		if (found === undefined || found === null) {
			return undefined;
		}
		if (typeof found !== "string" || found.length === 0) {
			return fail(`has a non-string ${field}`);
		}
		return found;
	};
	const pairedAt = requireString("pairedAt");
	if (Number.isNaN(Date.parse(pairedAt))) {
		return fail("has an unparseable pairedAt");
	}
	const record: PairedDeviceRecord = {
		deviceId: requireString("deviceId"),
		publicKey: requireString("publicKey"),
		label: requireString("label"),
		pairedAt,
		...(optionalString("lastSeenAt") !== undefined
			? { lastSeenAt: optionalString("lastSeenAt") as string }
			: {}),
		...(optionalString("revokedAt") !== undefined
			? { revokedAt: optionalString("revokedAt") as string }
			: {}),
		...(raw.approvalPolicy === undefined
			? {}
			: { approvalPolicy: coerceStoredPolicy(raw.approvalPolicy) }),
	};
	// Throws when the id was not derived from the public key, which is how a
	// hostile file would show one identity while authorising another key.
	return assertRecordSelfConsistent(record);
}

/** Anything short of a complete, valid policy reads as the strictest policy. */
function coerceStoredPolicy(value: unknown): ApprovalPolicy {
	if (typeof value !== "object" || value === null) {
		return { ...STRICTEST_APPROVAL_POLICY };
	}
	const raw = value as Record<string, unknown>;
	for (const tier of ["read", "write", "execute"] as const) {
		if (raw[tier] !== "auto" && raw[tier] !== "ask") {
			return { ...STRICTEST_APPROVAL_POLICY };
		}
	}
	return normalizeApprovalPolicy(raw as Partial<ApprovalPolicy>);
}

/** Node fs-backed `DeviceStore`; kept out of @cline/hub-pairing so that stays RN-safe. */
export function createFileDeviceStore(path = hubDevicesPath()): DeviceStore {
	return {
		async load() {
			let contents: string;
			try {
				contents = await readFile(path, "utf8");
			} catch (error) {
				if (isMissingFile(error)) {
					// Genuinely no devices yet. Every other error must NOT look like this:
					// an empty registry that the next `pair` overwrites would destroy all
					// records, revocation markers included.
					return [];
				}
				throw new Error(
					`Cannot read the paired-device store at ${path}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(contents);
			} catch (error) {
				throw new Error(
					`The paired-device store at ${path} is corrupt (${
						error instanceof Error ? error.message : String(error)
					}). It has NOT been rewritten; fix or restore the file. Overwriting it would drop every paired device and every revocation.`,
				);
			}
			if (!Array.isArray(parsed)) {
				throw new Error(
					`The paired-device store at ${path} is not a JSON array; refusing to use or overwrite it.`,
				);
			}
			try {
				return parsed.map(parseDeviceRecord);
			} catch (error) {
				throw new Error(
					`The paired-device store at ${path} is invalid: ${
						error instanceof Error ? error.message : String(error)
					}. It has NOT been rewritten.`,
				);
			}
		},
		async save(records) {
			await writePrivateFile(path, `${JSON.stringify(records, null, 2)}\n`);
		},
		/**
		 * Notifies on any change to the store file, which is what lets a process
		 * holding live channels enforce a revocation performed by a different
		 * process (see `DeviceRegistry.startRevocationWatch`).
		 */
		watch(onChange) {
			const watcher = watch(dirname(path), (_event, filename) => {
				if (!filename || filename === basename(path)) {
					onChange();
				}
			});
			watcher.on("error", () => {
				// A watch we cannot keep must not crash the process; revocation then
				// falls back to whatever calls `syncRevocations`.
			});
			return () => watcher.close();
		},
	};
}

export async function openDeviceRegistry(
	path = hubDevicesPath(),
): Promise<DeviceRegistry> {
	return DeviceRegistry.open(createFileDeviceStore(path));
}

// ---------------------------------------------------------------------------
// Pending offers
// ---------------------------------------------------------------------------

/**
 * `<offerId>.offer.json`. The id is validated first: it arrives from a websocket
 * subprotocol on the hub side, so it is attacker-controlled input on its way to
 * `join()`.
 */
export function hubPairingOfferPath(
	offerId: string,
	dir = hubPairingOffersDir(),
): string {
	if (!isValidOfferId(offerId)) {
		throw new Error(`Refusing to use "${offerId}" as a pairing offer id`);
	}
	return join(dir, `${offerId}.offer.json`);
}

/**
 * Publishes an offer for the hub daemon to complete. This is the whole
 * CLI→daemon handover: after this returns, a phone can present the offer's secret
 * to the running hub and be enrolled.
 */
export async function writePairingOffer(
	offer: PairingOffer,
	dir = hubPairingOffersDir(),
): Promise<string> {
	const path = hubPairingOfferPath(offer.offerId, dir);
	await writePrivateFile(path, encodeStoredPairingOffer(offer));
	return path;
}

/** A pending offer, or `undefined` when there is no such file. */
export async function readPairingOffer(
	offerId: string,
	dir = hubPairingOffersDir(),
): Promise<PairingOffer | undefined> {
	const path = hubPairingOfferPath(offerId, dir);
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFile(error)) {
			return undefined;
		}
		throw error;
	}
	const offer = decodeStoredPairingOffer(contents);
	if (offer.offerId !== offerId) {
		// The file name is the index; a mismatch means the file was hand-edited or
		// planted, and completing it would pair a device against an offer whose
		// prologue the device computed from different values.
		throw new Error(
			`The pairing offer at ${path} claims id "${offer.offerId}"; refusing it.`,
		);
	}
	return offer;
}

/** Removes an offer file. Single-use is enforced by calling this on success. */
export async function deletePairingOffer(
	offerId: string,
	dir = hubPairingOffersDir(),
): Promise<void> {
	await rm(hubPairingOfferPath(offerId, dir), { force: true });
}

/**
 * Deletes offer files that can no longer be completed. Called opportunistically
 * so a machine that shows a lot of QR codes nobody scans does not accumulate
 * readable one-time secrets on disk forever.
 */
export async function pruneExpiredPairingOffers(
	now = Date.now(),
	dir = hubPairingOffersDir(),
): Promise<number> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return 0;
	}
	let removed = 0;
	for (const name of names) {
		if (!name.endsWith(".offer.json")) {
			continue;
		}
		const path = join(dir, name);
		try {
			const offer = decodeStoredPairingOffer(await readFile(path, "utf8"));
			if (offer.expiresAt > now) {
				continue;
			}
		} catch {
			// Unreadable/damaged offers can never be completed either.
		}
		await rm(path, { force: true }).catch(() => undefined);
		removed += 1;
	}
	return removed;
}
