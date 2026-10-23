/**
 * The whole `/handoff` path, end to end, against a real hub.
 *
 * `startTestHub` boots the production `startHubWebSocketServer`; the offer is
 * published with the same on-disk store `cline hub share` uses; the link is
 * decoded with the app's own `decodeHandoffUrl`; and the pairing and reconnection
 * handshakes run through the app's production code. The only substitutions are
 * the scripted model behind the hub and SecureStore (a Node test has no Keychain).
 *
 * If this suite passes, a phone that scans the QR connects.
 */

import { join } from "node:path";
import { writePairingOffer } from "@cline/core/hub/pairing";
import {
	createPairingOffer,
	encodePairingUri,
	generateDeviceKeyPair,
	HUB_HANDSHAKE_MAX_WIRE_BYTES,
} from "@cline/hub-pairing";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it } from "vitest";
import { decodeHandoffUrl } from "@/state/handoff-link";
import { SessionConnectionController } from "./controller";
import {
	createPairedHubWebSocketImpl,
	isRelayHandoffUrl,
	pairHubHandoffLink,
} from "./hub-pairing-socket";

let hub: TestHub | undefined;
const controllers: SessionConnectionController[] = [];
const device = generateDeviceKeyPair();

const deviceDeps = {
	loadDevicePrivateKey: async () => device.privateKey,
	WebSocketImpl: globalThis.WebSocket as never,
};

afterEach(async () => {
	for (const controller of controllers.splice(0)) {
		controller.dispose();
	}
	await hub?.close();
	hub = undefined;
});

/**
 * The link a machine prints, produced the way `cline hub share` produces it: an
 * offer minted against the hub's identity and left in the hub's `offers/` tree.
 */
async function printHandoffLink(
	testHub: TestHub,
	options: { ttlMs?: number; sessionId?: string } = {},
): Promise<string> {
	const identity = await loadOrCreateHubIdentityAt(testHub);
	const created = createPairingOffer({
		hubPublicKey: identity.publicKey,
		hubName: "Examples MacBook Pro",
		url: testHub.url,
		ttlMs: options.ttlMs ?? 120_000,
		...(options.sessionId ? { sessionId: options.sessionId } : {}),
	});
	await writePairingOffer(created.offer, join(testHub.pairingDir, "offers"));
	return encodePairingUri(created.offer, { format: "handoff" });
}

async function loadOrCreateHubIdentityAt(testHub: TestHub) {
	const { loadOrCreateHubIdentity: load } = await import(
		"@cline/core/hub/pairing"
	);
	return await load(join(testHub.pairingDir, "identity.json"));
}

const TURN = {
	approvals: "auto-approve" as const,
	script: [{ kind: "text" as const, chunks: ["Paired ", "and running."] }],
};

describe("handoff pairing against a real hub", () => {
	it("rejects an oversized response before decoding the handshake", async () => {
		class OversizedHandshakeSocket {
			readyState = 0;
			private readonly listeners = new Map<
				string,
				Array<(...args: unknown[]) => void>
			>();

			constructor() {
				queueMicrotask(() => this.emit("open", {}));
			}

			send(): void {
				queueMicrotask(() =>
					this.emit("message", {
						data: "x".repeat(HUB_HANDSHAKE_MAX_WIRE_BYTES + 1),
					}),
				);
			}

			close(): void {
				this.readyState = 3;
				queueMicrotask(() => this.emit("close", {}));
			}

			addEventListener(
				type: string,
				listener: (...args: unknown[]) => void,
			): void {
				const current = this.listeners.get(type) ?? [];
				current.push(listener);
				this.listeners.set(type, current);
			}

			private emit(type: string, event: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) listener(event);
			}
		}

		const identity = generateDeviceKeyPair();
		const created = createPairingOffer({
			hubPublicKey: identity.publicKey,
			hubName: "Hostile machine",
			url: "ws://192.168.1.20:25463/hub",
		});
		const link = decodeHandoffUrl(
			encodePairingUri(created.offer, { format: "handoff" }),
		);
		await expect(
			pairHubHandoffLink(link, {
				loadDevicePrivateKey: async () => device.privateKey,
				WebSocketImpl: OversizedHandshakeSocket as never,
			}),
		).rejects.toThrow(/oversized pairing response/i);
	});

	it("treats a machine's own address as a hub link, not a relay link", async () => {
		expect(isRelayHandoffUrl("ws://127.0.0.1:25463/hub")).toBe(false);
		expect(isRelayHandoffUrl("ws://192.168.1.20:25463/hub")).toBe(false);
		expect(isRelayHandoffUrl("https://session.staging.cline.bot")).toBe(true);
	});

	it("pairs from the printed link and then drives a full turn with no token", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		expect(link.url).toBe(hub.url);

		const descriptor = await pairHubHandoffLink(link, deviceDeps);
		expect(descriptor.credentialKind).toBe("device-key");
		expect(descriptor.transport).toBe("direct");
		// The saved row carries no hub token: that is the point of the exercise.
		expect(descriptor.authToken).toBeUndefined();
		expect(JSON.stringify(descriptor)).not.toContain(hub.authToken);

		const controller = new SessionConnectionController(descriptor, {
			workspaceRoot: hub.runtimeHost.workspaceRoot,
			approvalPolicy: { read: "auto", write: "auto", execute: "auto" },
		});
		controllers.push(controller);
		await controller.start();
		expect(controller.getSnapshot().status.phase).toBe("ready");

		await controller.sendInput("hello from the phone");
		const blocks = controller
			.getSnapshot()
			.view.messages.flatMap((message) => message.blocks);
		expect(blocks).toContainEqual({
			kind: "text",
			text: "Paired and running.",
		});
	});

	it("reconnects a paired device with no second QR", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		const descriptor = await pairHubHandoffLink(link, deviceDeps);

		// Two more connections on the saved row alone. Each is a fresh Noise IK
		// exchange, which also proves the hub's replay guard is not tripped by a
		// legitimate reconnect.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const controller = new SessionConnectionController(descriptor, {
				workspaceRoot: hub.runtimeHost.workspaceRoot,
			});
			controllers.push(controller);
			await controller.start();
			expect(controller.getSnapshot().status.phase).toBe("ready");
			controller.dispose();
		}
	});

	it("refuses to pair with the wrong secret, and saves nothing", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		await expect(
			pairHubHandoffLink(
				{ ...link, oneTimeSecret: new Uint8Array(32).fill(1) },
				deviceDeps,
			),
		).rejects.toThrow(/handshake failed|refused|Run \/handoff/);
	});

	it("refuses to pair on an offer the hub never saw", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		await expect(
			pairHubHandoffLink({ ...link, offerId: "notAnOffer" }, deviceDeps),
		).rejects.toThrow(/no pairing code waiting|Run \/handoff/);
	});

	it("refuses a second pairing on the same link", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		await pairHubHandoffLink(link, deviceDeps);
		await expect(pairHubHandoffLink(link, deviceDeps)).rejects.toThrow(
			/already been used/,
		);
	});

	it("tells the user in words when the machine revoked the device", async () => {
		hub = await startTestHub(TURN);
		const link = decodeHandoffUrl(await printHandoffLink(hub));
		const descriptor = await pairHubHandoffLink(link, deviceDeps);

		const { openDeviceRegistry } = await import("@cline/core/hub/pairing");
		const registry = await openDeviceRegistry(
			join(hub.pairingDir, "devices.json"),
		);
		const [record] = registry.list();
		await registry.revoke(record?.deviceId ?? "");

		const Ctor = createPairedHubWebSocketImpl(descriptor, {
			WebSocketImpl: globalThis.WebSocket as never,
		});
		const socket = new Ctor(descriptor.url);
		const message = await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("no refusal")), 8_000);
			socket.addEventListener("error", (event: unknown) => {
				clearTimeout(timer);
				resolve((event as { message?: string }).message ?? "");
			});
			socket.addEventListener("open", () => {
				clearTimeout(timer);
				reject(new Error("a revoked device was allowed to connect"));
			});
		});
		expect(message).toContain("removed from that computer");
	});
});
