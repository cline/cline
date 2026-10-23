/**
 * Tests for the hub-side device allowlist.
 *
 * The property that matters: authentication is never authorisation. A device can
 * hold a perfectly good key and still be refused because the laptop revoked it —
 * and revocation must land on connections that are already open.
 */
import { describe, expect, it, vi } from "vitest";
import {
	deterministicRandom,
	FIXED_NOW,
	pairFixture,
	registryWith,
} from "./__tests__/support.js";
import { base64UrlToBytes } from "./bytes.js";
import { DeviceRevokedError, DeviceUnknownError } from "./errors.js";
import {
	deviceFingerprint,
	deviceIdFromPublicKey,
	encodePublicKey,
	generateDeviceKeyPair,
} from "./keys.js";
import { acceptDeviceSession, startDeviceSession } from "./pairing.js";
import {
	createInMemoryDeviceStore,
	DEFAULT_APPROVAL_POLICY,
	DeviceRegistry,
	type DeviceStore,
	normalizeApprovalPolicy,
	STRICTEST_APPROVAL_POLICY,
} from "./registry.js";

describe("DeviceRegistry basics", () => {
	it("adds, lists and looks up devices by public key", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});

		expect(registry.list()).toHaveLength(1);
		expect(registry.get(record.deviceId)?.label).toBe("iPhone");
		expect(registry.findByPublicKey(keyPair.publicKey)?.deviceId).toBe(
			record.deviceId,
		);
		expect(registry.fingerprintOf(record)).toBe(
			deviceFingerprint(keyPair.publicKey),
		);
		expect(record.pairedAt).toBe(new Date(FIXED_NOW).toISOString());
	});

	it("ATTACK: a record whose deviceId does not derive from its publicKey is refused", async () => {
		const attacker = generateDeviceKeyPair(deterministicRandom("attacker"));
		const trusted = generateDeviceKeyPair(deterministicRandom("trusted"));
		// A hostile devices.json that pairs the ATTACKER's device id (what the user
		// sees and grants policy to) with a TRUSTED public key (what actually gets
		// authorised at handshake time). Either half alone looks legitimate.
		const hostile = {
			deviceId: deviceIdFromPublicKey(attacker.publicKey),
			publicKey: encodePublicKey(trusted.publicKey),
			label: "iPhone",
			pairedAt: new Date(FIXED_NOW).toISOString(),
			approvalPolicy: { read: "auto", write: "auto", execute: "auto" },
		} as const;

		await expect(registryWith([hostile])).rejects.toThrow(/device id/i);
	});

	it("persists through the injected store", async () => {
		const store = createInMemoryDeviceStore();
		const first = await DeviceRegistry.open(store, { now: () => FIXED_NOW });
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		await first.add({ publicKey: keyPair.publicKey, label: "iPhone" });

		// A fresh registry over the same store sees the device.
		const second = await DeviceRegistry.open(store, { now: () => FIXED_NOW });
		expect(second.list().map((record) => record.label)).toEqual(["iPhone"]);
		expect(base64UrlToBytes(second.list()[0]?.publicKey as string)).toEqual(
			keyPair.publicKey,
		);
	});

	it("records lastSeenAt on touch", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		expect(registry.get(record.deviceId)?.lastSeenAt).toBeUndefined();
		await registry.touch(record.deviceId);
		expect(registry.get(record.deviceId)?.lastSeenAt).toBe(
			new Date(FIXED_NOW).toISOString(),
		);
	});

	it("hides revoked devices from the default listing but keeps them on request", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		await registry.revoke(record.deviceId);
		expect(registry.list()).toHaveLength(0);
		expect(registry.list({ includeRevoked: true })).toHaveLength(1);
	});

	it("throws when revoking an unknown device", async () => {
		const registry = await registryWith();
		await expect(registry.revoke("NOSUCHDEVICE")).rejects.toThrow(
			DeviceUnknownError,
		);
	});

	it("distinguishes unknown from revoked in assertAuthorized", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		expect(() => registry.assertAuthorized("NOSUCHDEVICE")).toThrow(
			DeviceUnknownError,
		);
		expect(registry.isAuthorized(record.deviceId)).toBe(true);
		await registry.revoke(record.deviceId);
		expect(registry.isAuthorized(record.deviceId)).toBe(false);
		expect(() => registry.assertAuthorized(record.deviceId)).toThrow(
			DeviceRevokedError,
		);
	});
});

describe("tiered approval policy", () => {
	it("gives a newly paired device the conservative default", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		expect(record.approvalPolicy).toEqual({
			read: "auto",
			write: "ask",
			execute: "ask",
		});
		expect(registry.getApprovalPolicy(record.deviceId)).toEqual(
			DEFAULT_APPROVAL_POLICY,
		);
	});

	it("stores policy per device, not globally", async () => {
		const registry = await registryWith();
		const first = await registry.add({
			publicKey: generateDeviceKeyPair(deterministicRandom("d1")).publicKey,
			label: "iPhone",
		});
		const second = await registry.add({
			publicKey: generateDeviceKeyPair(deterministicRandom("d2")).publicKey,
			label: "iPad",
		});
		await registry.setApprovalPolicy(first.deviceId, {
			read: "auto",
			write: "auto",
			execute: "auto",
		});
		expect(registry.getApprovalPolicy(first.deviceId)).toEqual({
			read: "auto",
			write: "auto",
			execute: "auto",
		});
		// The second device is untouched.
		expect(registry.getApprovalPolicy(second.deviceId)).toEqual(
			DEFAULT_APPROVAL_POLICY,
		);
	});

	it("reconnects a live device when its policy changes", async () => {
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: generateDeviceKeyPair(deterministicRandom("d1")).publicKey,
			label: "iPhone",
		});
		let closed = 0;
		registry.bindChannel(record.deviceId, { close: () => closed++ });

		await registry.setApprovalPolicy(record.deviceId, {
			read: "ask",
			write: "ask",
			execute: "ask",
		});

		expect(closed).toBe(1);
	});

	it("drops an older channel when the same device key is paired again", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		let closed = 0;
		registry.bindChannel(record.deviceId, { close: () => closed++ });

		await registry.add({ publicKey: keyPair.publicKey, label: "iPhone again" });

		expect(closed).toBe(1);
		expect(registry.get(record.deviceId)?.label).toBe("iPhone again");
	});

	it("reconnects on a policy change written by another process", async () => {
		const shared = createInMemoryDeviceStore();
		const owner = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });
		const record = await owner.add({
			publicKey: generateDeviceKeyPair(deterministicRandom("d1")).publicKey,
			label: "iPhone",
		});
		let closed = 0;
		owner.bindChannel(record.deviceId, { close: () => closed++ });
		const cli = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });

		await cli.setApprovalPolicy(record.deviceId, {
			read: "auto",
			write: "auto",
			execute: "auto",
		});
		await owner.syncRevocations();

		expect(closed).toBe(1);
	});

	it('normalises anything that is not exactly "auto" to "ask" (fail closed)', () => {
		expect(normalizeApprovalPolicy(undefined)).toEqual(
			STRICTEST_APPROVAL_POLICY,
		);
		expect(normalizeApprovalPolicy({ read: "auto" })).toEqual({
			read: "auto",
			write: "ask",
			execute: "ask",
		});
		expect(
			normalizeApprovalPolicy({
				read: "yes" as unknown as "auto",
				write: "AUTO" as unknown as "auto",
			}),
		).toEqual(STRICTEST_APPROVAL_POLICY);
	});

	it("reports the strictest policy for an unknown device", async () => {
		const registry = await registryWith();
		expect(registry.getApprovalPolicy("NOSUCHDEVICE")).toEqual(
			STRICTEST_APPROVAL_POLICY,
		);
	});

	it("drops the policy on revoke and refuses to set a new one", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		await registry.setApprovalPolicy(record.deviceId, {
			read: "auto",
			write: "auto",
			execute: "auto",
		});
		await registry.revoke(record.deviceId);

		expect(registry.get(record.deviceId)?.approvalPolicy).toBeUndefined();
		expect(registry.getApprovalPolicy(record.deviceId)).toEqual(
			STRICTEST_APPROVAL_POLICY,
		);
		await expect(
			registry.setApprovalPolicy(record.deviceId, { read: "auto" }),
		).rejects.toThrow(DeviceRevokedError);
	});

	it("re-pairing a revoked device starts from the conservative default", async () => {
		const registry = await registryWith();
		const keyPair = generateDeviceKeyPair(deterministicRandom("d1"));
		const record = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		await registry.setApprovalPolicy(record.deviceId, {
			read: "auto",
			write: "auto",
			execute: "auto",
		});
		await registry.revoke(record.deviceId);

		// The user scanned a fresh QR on the laptop, so access comes back — but the
		// previously opted-up permissions must NOT come back with it.
		const readded = await registry.add({
			publicKey: keyPair.publicKey,
			label: "iPhone",
		});
		expect(readded.revokedAt).toBeUndefined();
		expect(registry.getApprovalPolicy(readded.deviceId)).toEqual(
			DEFAULT_APPROVAL_POLICY,
		);
	});

	it("surfaces the effective policy on an accepted session", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		await registry.setApprovalPolicy(record.deviceId, {
			read: "auto",
			write: "auto",
			execute: "ask",
		});
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry,
			message: pending.message,
		});
		expect(accepted.approvalPolicy).toEqual({
			read: "auto",
			write: "auto",
			execute: "ask",
		});
	});
});

describe("revocation kills access", () => {
	it("ATTACK: a revoked device cannot establish a new channel", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});

		// Works before revocation.
		const before = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: before.message,
			}),
		).not.toThrow();

		await registry.revoke(record.deviceId);

		// The key is unchanged and the handshake is still cryptographically valid;
		// authorisation is what refuses it.
		const after = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: after.message,
			}),
		).toThrow(DeviceRevokedError);
	});

	it("ATTACK: revocation terminates a channel that is already open", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});

		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry,
			message: pending.message,
		});
		const phone = pending.complete(accepted.message);
		registry.bindChannel(record.deviceId, accepted.channel);

		// Traffic flows.
		expect(
			phone.channel.decryptFrame(accepted.channel.encryptFrame({ ok: true })),
		).toEqual({ ok: true });

		await registry.revoke(record.deviceId);

		// The live session is dead, mid-flight, without waiting for a reconnect.
		expect(accepted.channel.closed).toBe(true);
		expect(() => accepted.channel.encryptFrame({ ok: true })).toThrow(/closed/);
		expect(() =>
			accepted.channel.decryptFrame(phone.channel.encryptFrame({ hi: 1 })),
		).toThrow(/closed/);
	});

	it("ATTACK: revocation terminates a session nobody remembered to bind", async () => {
		// acceptDeviceSession holds both the registry and the channel it just
		// authorised, so binding must not be left to the caller: a caller that
		// forgets leaves revocation unable to reach in-flight sessions at all.
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry,
			message: pending.message,
		});

		await registry.revoke(record.deviceId);

		expect(accepted.channel.closed).toBe(true);
	});

	it("ATTACK: a store write failure cannot leave a revoked device encrypting", async () => {
		const fixture = pairFixture();
		const store = createInMemoryDeviceStore();
		const registry = await DeviceRegistry.open(store, { now: () => FIXED_NOW });
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		let closed = 0;
		registry.bindChannel(record.deviceId, {
			close: () => {
				closed += 1;
			},
		});
		store.save = async () => {
			throw new Error("disk full");
		};

		await expect(registry.revoke(record.deviceId)).rejects.toThrow("disk full");
		// The security-relevant half must have happened anyway.
		expect(closed).toBe(1);
		expect(registry.isAuthorized(record.deviceId)).toBe(false);
	});

	it("ATTACK: a revoke from another process terminates this process's channel", async () => {
		// Two registries over one store model two processes: the CLI that revokes
		// and the hub that owns the live channel. The owner enforces revocation.
		const fixture = pairFixture();
		const shared = createInMemoryDeviceStore();
		const owner = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });
		const record = await owner.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry: owner,
			message: pending.message,
		});
		expect(accepted.channel.closed).toBe(false);

		const cli = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });
		await cli.revoke(record.deviceId);
		// The other process's in-memory map was untouched by that revoke...
		expect(accepted.channel.closed).toBe(false);

		// ...until the owner reads the persisted revocation marker.
		await owner.syncRevocations();
		expect(accepted.channel.closed).toBe(true);
		expect(owner.isAuthorized(record.deviceId)).toBe(false);
		const reconnect = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		expect(() =>
			acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry: owner,
				message: reconnect.message,
			}),
		).toThrow(DeviceRevokedError);
	});

	it("a store watch drives revocation enforcement without polling", async () => {
		const fixture = pairFixture();
		const listeners = new Set<() => void>();
		const base = createInMemoryDeviceStore();
		const shared: DeviceStore = {
			load: base.load,
			async save(records) {
				await base.save(records);
				for (const listener of listeners) {
					listener();
				}
			},
			watch(onChange) {
				listeners.add(onChange);
				return () => listeners.delete(onChange);
			},
		};
		const owner = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });
		const record = await owner.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		const stop = owner.startRevocationWatch();
		const pending = startDeviceSession({
			devicePrivateKey: fixture.deviceKeyPair.privateKey,
			hubPublicKey: fixture.hubKeyPair.publicKey,
		});
		const accepted = acceptDeviceSession({
			hubPrivateKey: fixture.hubKeyPair.privateKey,
			registry: owner,
			message: pending.message,
		});

		const cli = await DeviceRegistry.open(shared, { now: () => FIXED_NOW });
		await cli.revoke(record.deviceId);
		await vi.waitFor(() => expect(accepted.channel.closed).toBe(true));
		stop();
	});

	it("does not accumulate dead channels across reconnects", async () => {
		// Binding is automatic now, so a hub that reconnects for hours must not grow
		// its live-channel set without bound.
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const pending = startDeviceSession({
				devicePrivateKey: fixture.deviceKeyPair.privateKey,
				hubPublicKey: fixture.hubKeyPair.publicKey,
			});
			const accepted = acceptDeviceSession({
				hubPrivateKey: fixture.hubKeyPair.privateKey,
				registry,
				message: pending.message,
			});
			// The phone drops off; the hub closes its side but forgets to release.
			accepted.channel.close();
		}
		expect(registry.liveChannelCount(record.deviceId)).toBe(1);
	});

	it("does not bind a channel that closed during asynchronous authentication", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		const release = registry.bindChannel(record.deviceId, {
			closed: true,
			close: vi.fn(),
		});
		expect(registry.liveChannelCount(record.deviceId)).toBe(0);
		expect(release).not.toThrow();
	});

	it("unbinding stops a clean disconnect from being terminated later", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		let closed = 0;
		const unbind = registry.bindChannel(record.deviceId, {
			close: () => {
				closed += 1;
			},
		});
		unbind();
		await registry.revoke(record.deviceId);
		expect(closed).toBe(0);
	});

	it("terminates every channel bound to a device", async () => {
		const fixture = pairFixture();
		const registry = await registryWith();
		const record = await registry.add({
			publicKey: fixture.deviceKeyPair.publicKey,
			label: "iPhone",
		});
		let closed = 0;
		for (let index = 0; index < 3; index += 1) {
			registry.bindChannel(record.deviceId, {
				close: () => {
					closed += 1;
				},
			});
		}
		await registry.revoke(record.deviceId);
		expect(closed).toBe(3);
	});
});
