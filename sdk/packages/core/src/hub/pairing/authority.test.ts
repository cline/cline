/**
 * Adversarial coverage of the hub's pairing authority. This is an authentication
 * path, so the interesting cases are the refusals: a wrong secret, a replayed
 * offer, an offer the hub's own clock says is dead, and a revoked device.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acceptPairingOffer,
	createPairingOffer,
	generateDeviceKeyPair,
	type PairingOffer,
	startDeviceSession,
} from "@cline/hub-pairing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createFileHubPairingAuthority,
	type HubPairingAuthority,
} from "./authority";
import {
	loadOrCreateHubIdentity,
	openDeviceRegistry,
	writePairingOffer,
} from "./store";

const FIXED_NOW = 1_800_000_000_000;

let dir: string;
let authority: HubPairingAuthority | undefined;
let clock = FIXED_NOW;

const paths = () => ({
	identityPath: join(dir, "identity.json"),
	devicesPath: join(dir, "devices.json"),
	offersDir: join(dir, "offers"),
});

function openAuthority(): HubPairingAuthority {
	authority = createFileHubPairingAuthority({ ...paths(), now: () => clock });
	return authority;
}

/** A live-socket stand-in: revocation must be able to close this. */
function fakeBinding() {
	let closed = false;
	return {
		get closed() {
			return closed;
		},
		close() {
			closed = true;
		},
	};
}

async function publishOffer(
	overrides: { ttlMs?: number; sessionId?: string } = {},
): Promise<PairingOffer> {
	const identity = await loadOrCreateHubIdentity(paths().identityPath);
	const created = createPairingOffer({
		hubPublicKey: identity.publicKey,
		hubName: "Examples MacBook Pro",
		url: "ws://127.0.0.1:25463/hub",
		ttlMs: overrides.ttlMs ?? 120_000,
		now: () => clock,
		...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
	});
	await writePairingOffer(created.offer, paths().offersDir);
	return created.offer;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "cline-hub-pairing-authority-"));
	clock = FIXED_NOW;
});

afterEach(async () => {
	await authority?.close();
	authority = undefined;
	await rm(dir, { recursive: true, force: true });
});

describe("pairing", () => {
	it("enrolls a device that holds the offer secret and reports the pinned hub key", async () => {
		const offer = await publishOffer({ sessionId: "sess_1" });
		const device = generateDeviceKeyPair();
		const pending = acceptPairingOffer(offer, device.privateKey, {
			now: () => clock,
			metadata: { label: "Examples iPhone", platform: "mobile" },
		});

		const accepted = await openAuthority().pair({
			offerId: offer.offerId,
			message: pending.attestation.message,
			bind: fakeBinding(),
		});

		expect(accepted.label).toBe("Examples iPhone");
		expect(accepted.hubPublicKey).toEqual(offer.hubPublicKey);
		expect(accepted.sessionId).toBe("sess_1");
		// The device finishes the handshake against the reply and pins what it saw.
		const finished = pending.complete(accepted.response);
		expect(finished.hub.publicKey).toEqual(offer.hubPublicKey);
		expect(finished.hub.hubName).toBe("Examples MacBook Pro");

		// Enrollment is durable: it is in devices.json, not just in memory.
		const stored = JSON.parse(await readFile(paths().devicesPath, "utf8")) as {
			deviceId: string;
			label: string;
		}[];
		expect(stored).toHaveLength(1);
		expect(stored[0]?.deviceId).toBe(accepted.deviceId);
	});

	it("refuses a device that does not hold the offer secret", async () => {
		const offer = await publishOffer();
		const device = generateDeviceKeyPair();
		// Same offer in every respect except the PSK: this is the attacker who read
		// the machine name and url off the screen but never had the QR.
		const guessed: PairingOffer = {
			...offer,
			oneTimeSecret: new Uint8Array(32).fill(9),
		};
		const pending = acceptPairingOffer(guessed, device.privateKey, {
			now: () => clock,
		});

		await expect(
			openAuthority().pair({
				offerId: offer.offerId,
				message: pending.attestation.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "attestation_rejected" });
		// A failed guess must not enroll anything, and must not burn the offer.
		const registry = await openDeviceRegistry(paths().devicesPath);
		expect(registry.list({ includeRevoked: true })).toHaveLength(0);
		expect(
			await readFile(
				join(paths().offersDir, `${offer.offerId}.offer.json`),
				"utf8",
			),
		).toContain(offer.offerId);
	});

	it("refuses an offer id the hub has no record of", async () => {
		await publishOffer();
		const device = generateDeviceKeyPair();
		const offer = await publishOffer();
		const pending = acceptPairingOffer(offer, device.privateKey, {
			now: () => clock,
		});
		await expect(
			openAuthority().pair({
				offerId: "neverMinted",
				message: pending.attestation.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "offer_invalid" });
	});

	it("is single-use: a replayed attestation is refused and the offer file is gone", async () => {
		const offer = await publishOffer();
		const device = generateDeviceKeyPair();
		const pending = acceptPairingOffer(offer, device.privateKey, {
			now: () => clock,
		});
		const hub = openAuthority();
		await hub.pair({
			offerId: offer.offerId,
			message: pending.attestation.message,
			bind: fakeBinding(),
		});

		await expect(
			hub.pair({
				offerId: offer.offerId,
				message: pending.attestation.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "offer_consumed" });
		await expect(
			readFile(join(paths().offersDir, `${offer.offerId}.offer.json`), "utf8"),
		).rejects.toThrow();

		// And a *fresh* hub process, which has no in-memory consumed set, refuses it
		// too — the deletion is the durable half of single-use.
		await authority?.close();
		await expect(
			openAuthority().pair({
				offerId: offer.offerId,
				message: pending.attestation.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "offer_invalid" });
	});

	it("lets only one of two simultaneous attempts on the same offer through", async () => {
		const offer = await publishOffer();
		const first = acceptPairingOffer(
			offer,
			generateDeviceKeyPair().privateKey,
			{
				now: () => clock,
			},
		);
		const second = acceptPairingOffer(
			offer,
			generateDeviceKeyPair().privateKey,
			{ now: () => clock },
		);
		const hub = openAuthority();
		const results = await Promise.allSettled([
			hub.pair({
				offerId: offer.offerId,
				message: first.attestation.message,
				bind: fakeBinding(),
			}),
			hub.pair({
				offerId: offer.offerId,
				message: second.attestation.message,
				bind: fakeBinding(),
			}),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
	});

	it("refuses an expired offer on the HUB's clock, not just the device's", async () => {
		const offer = await publishOffer({ ttlMs: 60_000 });
		// The device is told the offer is still fresh — a phone with a slow clock, or
		// a hostile client that simply skips its own expiry check.
		const pending = acceptPairingOffer(
			offer,
			generateDeviceKeyPair().privateKey,
			{
				now: () => FIXED_NOW,
			},
		);
		clock = FIXED_NOW + 60_001;

		await expect(
			openAuthority().pair({
				offerId: offer.offerId,
				message: pending.attestation.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "offer_expired" });
		// A dead offer's secret does not stay readable on disk.
		await expect(
			readFile(join(paths().offersDir, `${offer.offerId}.offer.json`), "utf8"),
		).rejects.toThrow();
	});

	it("refuses to pair at all on a machine with no identity", async () => {
		const stranger = generateDeviceKeyPair();
		const offer = createPairingOffer({
			hubPublicKey: stranger.publicKey,
			hubName: "Elsewhere",
			url: "ws://127.0.0.1:1/hub",
			now: () => clock,
		}).offer;
		await writePairingOffer(offer, paths().offersDir);
		await rm(paths().identityPath, { force: true });
		await expect(
			openAuthority().pair({
				offerId: offer.offerId,
				message: new Uint8Array(96),
				bind: fakeBinding(),
			}),
		).rejects.toThrow(/no pairing identity/);
	});

	it("picks up an identity created after the hub started", async () => {
		// The normal order of events: `cline hub start` runs long before the user's
		// first `cline hub share`, and it is the share that creates identity.json.
		// A hub that cached "no identity" would refuse every pairing until restarted.
		const hub = openAuthority();
		expect(await hub.isAvailable()).toBe(false);

		const offer = await publishOffer();
		const device = generateDeviceKeyPair();
		const pending = acceptPairingOffer(offer, device.privateKey, {
			now: () => clock,
		});
		expect(await hub.isAvailable()).toBe(true);
		const accepted = await hub.pair({
			offerId: offer.offerId,
			message: pending.attestation.message,
			bind: fakeBinding(),
		});
		expect(accepted.deviceId).toBeDefined();
	});

	it("refuses a planted offer file whose id does not match its name", async () => {
		const offer = await publishOffer();
		const path = join(paths().offersDir, `${offer.offerId}.offer.json`);
		const contents = JSON.parse(await readFile(path, "utf8")) as Record<
			string,
			unknown
		>;
		await writeFile(
			path,
			JSON.stringify({ ...contents, offerId: "someOtherOffer" }),
		);
		await expect(
			openAuthority().pair({
				offerId: offer.offerId,
				message: new Uint8Array(96),
				bind: fakeBinding(),
			}),
		).rejects.toThrow(/refusing it/);
	});
});

describe("returning device sessions", () => {
	async function enroll(): Promise<{
		hub: HubPairingAuthority;
		devicePrivateKey: Uint8Array;
		hubPublicKey: Uint8Array;
		deviceId: string;
	}> {
		const offer = await publishOffer();
		const device = generateDeviceKeyPair();
		const pending = acceptPairingOffer(offer, device.privateKey, {
			now: () => clock,
		});
		const hub = openAuthority();
		const accepted = await hub.pair({
			offerId: offer.offerId,
			message: pending.attestation.message,
			bind: fakeBinding(),
		});
		return {
			hub,
			devicePrivateKey: device.privateKey,
			hubPublicKey: offer.hubPublicKey,
			deviceId: accepted.deviceId,
		};
	}

	it("lets a paired device reconnect with no token and no fresh offer", async () => {
		const { hub, devicePrivateKey, hubPublicKey, deviceId } = await enroll();
		const session = startDeviceSession({ devicePrivateKey, hubPublicKey });
		const accepted = await hub.openDeviceSession({
			message: session.message,
			bind: fakeBinding(),
		});
		expect(accepted.deviceId).toBe(deviceId);
		// The device completes against the reply, which proves it talked to the hub
		// key it pinned at pairing time.
		expect(() => session.complete(accepted.response)).not.toThrow();
	});

	it("refuses a device that was never paired", async () => {
		await publishOffer();
		const hub = openAuthority();
		const identity = await loadOrCreateHubIdentity(paths().identityPath);
		const stranger = generateDeviceKeyPair();
		const session = startDeviceSession({
			devicePrivateKey: stranger.privateKey,
			hubPublicKey: identity.publicKey,
		});
		await expect(
			hub.openDeviceSession({
				message: session.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "device_unknown" });
	});

	it("refuses a revoked device, and drops the socket it was holding", async () => {
		const { hub, devicePrivateKey, hubPublicKey, deviceId } = await enroll();
		const live = fakeBinding();
		await hub.openDeviceSession({
			message: startDeviceSession({ devicePrivateKey, hubPublicKey }).message,
			bind: live,
		});

		// Revocation happens in another process: `cline hub devices revoke` opens the
		// same file-backed registry and writes the marker.
		const cli = await openDeviceRegistry(paths().devicesPath);
		await cli.revoke(deviceId);

		await expect(
			hub.openDeviceSession({
				message: startDeviceSession({ devicePrivateKey, hubPublicKey }).message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "device_revoked" });
		// The connection it already had is closed rather than left running.
		expect(live.closed).toBe(true);
	});

	it("refuses a replayed session handshake", async () => {
		const { hub, devicePrivateKey, hubPublicKey } = await enroll();
		const session = startDeviceSession({ devicePrivateKey, hubPublicKey });
		await hub.openDeviceSession({
			message: session.message,
			bind: fakeBinding(),
		});
		await expect(
			hub.openDeviceSession({
				message: session.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "session_replayed" });
	});

	it("refuses a session aimed at a different hub key", async () => {
		const { hub, devicePrivateKey } = await enroll();
		const elsewhere = generateDeviceKeyPair();
		const session = startDeviceSession({
			devicePrivateKey,
			hubPublicKey: elsewhere.publicKey,
		});
		await expect(
			hub.openDeviceSession({
				message: session.message,
				bind: fakeBinding(),
			}),
		).rejects.toMatchObject({ code: "attestation_rejected" });
	});
});
