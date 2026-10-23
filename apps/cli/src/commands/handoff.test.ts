import { describe, expect, it, vi } from "vitest";

const { mockResolveClineDataDir } = vi.hoisted(() => ({
	mockResolveClineDataDir: vi.fn(() => "/tmp/cline-data-handoff"),
}));

vi.mock("@cline/shared/storage", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
}));

import {
	createPairingOffer,
	type DeviceRegistry,
	decodeHandoffUri,
	deviceFingerprint,
	encodePairingUri,
	generateDeviceKeyPair,
	type PairingOffer,
} from "@cline/hub-pairing";
import {
	buildHandoffPresentation,
	cleanMachineName,
	createSessionHandoffRunner,
	DEFAULT_HANDOFF_TTL_MS,
	formatHandoffExpiry,
	formatHandoffJson,
	formatHandoffTerminalLines,
	type HandoffDeps,
	handoffQrFitsIn,
	runHandoff,
} from "./handoff";

const HUB_URL = "ws://127.0.0.1:25463/hub";
// Shaped like a real hub token: `randomBytes(32).toString("hex")`.
const HUB_TOKEN = "63baaf16".repeat(8);
const RELAY_URL = "wss://session.cline.bot";
const FIXED_NOW = 1_800_000_000_000;
const identity = generateDeviceKeyPair();

/** Offers the machine published for the hub to complete, newest last. */
let published: PairingOffer[] = [];

function deps(overrides: Partial<HandoffDeps> = {}): HandoffDeps {
	published = [];
	return {
		now: () => FIXED_NOW,
		hostname: () => "Examples-MacBook-Pro.local",
		loadIdentity: async () => identity,
		readHubEndpoint: async () => ({ url: HUB_URL, authToken: HUB_TOKEN }),
		latestSessionId: async () => "sess_latest",
		openDeviceRegistry: async () => ({}) as DeviceRegistry,
		publishPairingOffer: async (offer) => {
			published.push(offer);
		},
		startRelayHandoff: async (input) => {
			const created = createPairingOffer({
				hubPublicKey: input.identity.publicKey,
				hubName: input.machineName,
				url: RELAY_URL,
				ttlMs: input.ttlMs,
				now: input.now,
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
			});
			return {
				uri: encodePairingUri(created.offer, { format: "handoff" }),
				relayUrl: RELAY_URL,
				expiresAt: created.expiresAt,
				offerId: created.offer.offerId,
			};
		},
		shouldUseRelay: async () => false,
		...overrides,
	};
}

describe("cleanMachineName", () => {
	it("turns a hostname into something a phone can show a human", () => {
		expect(cleanMachineName("Examples-MacBook-Pro.local")).toBe(
			"Examples MacBook Pro",
		);
		expect(cleanMachineName("examples_macbook.lan")).toBe("examples macbook");
		expect(cleanMachineName("build-box-01.localdomain")).toBe("build box 01");
		// An already-friendly name is left alone.
		expect(cleanMachineName("Example's MacBook Pro")).toBe("Example's MacBook Pro");
	});

	it("falls back to a generic name when the hostname is unusable", () => {
		expect(cleanMachineName("")).toBe("This machine");
		expect(cleanMachineName("   ")).toBe("This machine");
		expect(cleanMachineName("localhost")).toBe("This machine");
	});
});

describe("formatHandoffExpiry", () => {
	it("prints the expiry the way the person looking at the QR thinks about it", () => {
		expect(formatHandoffExpiry(120_000)).toBe("2 minutes");
		expect(formatHandoffExpiry(60_000)).toBe("1 minute");
		expect(formatHandoffExpiry(90_000)).toBe("90 seconds");
		expect(formatHandoffExpiry(45_000)).toBe("45 seconds");
	});
});

describe("runHandoff", () => {
	it("mints a clinecode handoff URI pinned to the session being handed off", async () => {
		const result = await runHandoff({ sessionId: "sess_current" }, deps());

		expect(result.uri.startsWith("clinecode://handoff?")).toBe(true);
		const decoded = decodeHandoffUri(result.uri);
		expect(decoded.sessionId).toBe("sess_current");
		// Straight at this machine's hub: no relay, no account, nothing to dial out.
		expect(decoded.url).toBe(HUB_URL);
		expect(result.transport).toBe("hub");
		expect(decoded.hubName).toBe("Examples MacBook Pro");
		expect(decoded.expiresAt).toBe(FIXED_NOW + DEFAULT_HANDOFF_TTL_MS);
		expect(decoded.offerId).toBeDefined();
		expect(decoded.credential).not.toBe(HUB_TOKEN);
		expect(result.machineName).toBe("Examples MacBook Pro");
		expect(result.sessionId).toBe("sess_current");
		expect(result.ttlMs).toBe(DEFAULT_HANDOFF_TTL_MS);
		expect(result.expiresAt).toBe(FIXED_NOW + DEFAULT_HANDOFF_TTL_MS);
		expect(result.fingerprint).toBe(deviceFingerprint(identity.publicKey));
	});

	it("defaults to two minutes and accepts a shorter window", async () => {
		expect(DEFAULT_HANDOFF_TTL_MS).toBe(120_000);
		const result = await runHandoff({ ttlMs: 30_000 }, deps());
		expect(result.expiresAt).toBe(FIXED_NOW + 30_000);
		expect(decodeHandoffUri(result.uri).expiresAt).toBe(FIXED_NOW + 30_000);
	});

	it("rejects non-finite and fractional TTLs instead of minting a NaN expiry", async () => {
		await expect(runHandoff({ ttlMs: Number.NaN }, deps())).rejects.toThrow(
			/TTL/,
		);
		await expect(runHandoff({ ttlMs: 1_500.5 }, deps())).rejects.toThrow(/TTL/);
	});

	it("falls back to the most recent session when none is given", async () => {
		const result = await runHandoff({}, deps());
		expect(result.sessionId).toBe("sess_latest");
		expect(decodeHandoffUri(result.uri).sessionId).toBe("sess_latest");
	});

	it("omits the session id when there is nothing to hand off", async () => {
		const result = await runHandoff(
			{},
			deps({ latestSessionId: async () => undefined }),
		);
		expect(result.sessionId).toBeUndefined();
		expect(result.uri).not.toContain("sid=");
		expect(decodeHandoffUri(result.uri).sessionId).toBeUndefined();
	});

	it("does not look up a session when the caller pins one", async () => {
		const latestSessionId = vi.fn(async () => "sess_latest");
		await runHandoff({ sessionId: "sess_pinned" }, deps({ latestSessionId }));
		expect(latestSessionId).not.toHaveBeenCalled();
	});

	it("honours an explicit machine name", async () => {
		const result = await runHandoff({ machineName: "Work laptop" }, deps());
		expect(result.machineName).toBe("Work laptop");
		expect(decodeHandoffUri(result.uri).hubName).toBe("Work laptop");
	});

	it("says what to do when the hub is not running", async () => {
		await expect(
			runHandoff({}, deps({ readHubEndpoint: async () => undefined })),
		).rejects.toThrow(/cline hub start/);
	});

	it("publishes the offer where the hub will find it, and puts its secret in the link", async () => {
		const result = await runHandoff({ sessionId: "sess_current" }, deps());
		expect(published).toHaveLength(1);
		const offer = published[0] as PairingOffer;
		const decoded = decodeHandoffUri(result.uri);
		// The link and the published offer are the same offer, or the hub would have
		// nothing to complete when the phone arrives.
		expect(decoded.offerId).toBe(offer.offerId);
		expect(result.offerId).toBe(offer.offerId);
		expect(decoded.credential).toBe(
			Buffer.from(offer.oneTimeSecret).toString("base64url"),
		);
		expect(decoded.expiresAt).toBe(offer.expiresAt);
		expect(offer.sessionId).toBe("sess_current");
	});

	it("needs no hub token at all, and never puts one in the link", async () => {
		// The whole point: `s` is a one-time pairing secret, so a hub that published
		// no token can still hand off, and the durable token never leaves the machine.
		const result = await runHandoff(
			{},
			deps({ readHubEndpoint: async () => ({ url: HUB_URL }) }),
		);
		expect(result.uri).not.toContain(HUB_TOKEN);
		expect(decodeHandoffUri(result.uri).credential).not.toBe(HUB_TOKEN);
		expect(published).toHaveLength(1);
	});

	it("routes through the relay only when asked, and needs the token to do it", async () => {
		const viaRelay = await runHandoff({ viaRelay: true }, deps());
		expect(viaRelay.transport).toBe("relay");
		expect(decodeHandoffUri(viaRelay.uri).url).toBe(RELAY_URL);
		// The relay bridge dials the local hub on the machine's behalf.
		await expect(
			runHandoff(
				{ viaRelay: true },
				deps({ readHubEndpoint: async () => ({ url: HUB_URL }) }),
			),
		).rejects.toThrow(/could not reach it/);
	});

	it("does not publish an offer for the relay path", async () => {
		// The relay bridge holds the offer in memory in the process that dialled out;
		// writing its secret to disk for a hub that will never read it is pure risk.
		await runHandoff({ viaRelay: true }, deps());
		expect(published).toEqual([]);
	});

	it("keeps the reserved hub key in the link", async () => {
		// The v1 phone drops `k`, but the QR shape must not change when the Noise
		// pairing ceremony lands, so it is still emitted and still valid.
		const decoded = decodeHandoffUri((await runHandoff({}, deps())).uri);
		expect(decoded.hubPublicKey).toEqual(identity.publicKey);
		expect(decoded.offerId).toBeDefined();
	});

	it("sanitizes a machine name that would corrupt the query", async () => {
		const result = await runHandoff({ machineName: "Bob&Co=1#lab+2" }, deps());
		expect(result.machineName).toBe("BobCo1lab2");
		expect(decodeHandoffUri(result.uri).hubName).toBe(result.machineName);
		expect(result.uri).not.toContain("+");
	});
});

describe("createSessionHandoffRunner", () => {
	it("defaults signed-in handoffs to the anywhere relay", async () => {
		const runner = createSessionHandoffRunner(
			() => "sess_one",
			deps({ shouldUseRelay: async () => true }),
		);
		const result = await runner();
		expect(result.transport).toBe("relay");
		expect(decodeHandoffUri(result.uri).url).toBe(RELAY_URL);
	});

	it("honors an explicit direct handoff even when signed in", async () => {
		const runner = createSessionHandoffRunner(
			() => "sess_one",
			deps({ shouldUseRelay: async () => true }),
		);
		expect((await runner({ viaRelay: false })).transport).toBe("hub");
	});

	it("pins the session that is active at the moment /handoff runs", async () => {
		let active: string | undefined = "sess_one";
		const runner = createSessionHandoffRunner(() => active, deps());

		expect(decodeHandoffUri((await runner()).uri).sessionId).toBe("sess_one");
		active = "sess_two";
		expect(decodeHandoffUri((await runner()).uri).sessionId).toBe("sess_two");
	});

	it("hands off nothing rather than a stale session when none is active", async () => {
		const latestSessionId = vi.fn(async () => "sess_someone_else");
		const runner = createSessionHandoffRunner(
			() => undefined,
			deps({ latestSessionId }),
		);
		const result = await runner();
		expect(result.sessionId).toBeUndefined();
		expect(latestSessionId).not.toHaveBeenCalled();
	});
});

describe("handoff presentation", () => {
	it("puts the QR, the one-line instruction and a bare copyable URI in the terminal output", async () => {
		const result = await runHandoff({ sessionId: "sess_current" }, deps());
		const lines = formatHandoffTerminalLines(buildHandoffPresentation(result));
		const text = lines.join("\n");

		expect(text).toContain("Examples MacBook Pro");
		// The QR is rendered as half-blocks, not just the URI.
		expect(text).toMatch(/[█▀▄]/);
		expect(text).toContain("Scan this with Cline Code on your phone");
		// The URI must sit alone on its line so it can be double-clicked/copied.
		expect(lines.some((line) => line.trim() === result.uri)).toBe(true);
		expect(text).toContain("Pairing code expires in 2 minutes");
		expect(text).toContain("This machine enforces both");
		expect(text).toContain("hub token stays on this machine");
		expect(text).toContain("sess_current");
	});

	it("keeps the QR free of ANSI so the TUI can colour it itself", async () => {
		const result = await runHandoff({}, deps());
		const presentation = buildHandoffPresentation(result);
		expect(presentation.qrBlockLines.length).toBeGreaterThan(4);
		for (const line of presentation.qrBlockLines) {
			expect(line).not.toContain("\u001b");
			expect(line).toMatch(/^[█▀▄ ]+$/);
		}
	});

	it("refuses to draw a clipped QR in a short window", async () => {
		const result = await runHandoff({ sessionId: "sess_current" }, deps());
		const presentation = buildHandoffPresentation(result);
		const rows = presentation.qrBlockLines.length;

		// A standard 24-row terminal cannot hold the code plus its labels.
		expect(handoffQrFitsIn(presentation, 24)).toBe(false);
		expect(handoffQrFitsIn(presentation, rows + 13)).toBe(true);
		expect(handoffQrFitsIn(presentation, rows + 12)).toBe(false);
	});

	it("emits machine-readable JSON without leaking the identity private key", async () => {
		const result = await runHandoff({ sessionId: "sess_json" }, deps());
		const parsed = JSON.parse(formatHandoffJson(result));
		expect(parsed).toMatchObject({
			uri: result.uri,
			hubName: "Examples MacBook Pro",
			hubUrl: HUB_URL,
			transport: "hub",
			sessionId: "sess_json",
			hubFingerprint: deviceFingerprint(identity.publicKey),
			expiresAt: new Date(result.expiresAt).toISOString(),
			expiresInMs: DEFAULT_HANDOFF_TTL_MS,
			// Scripts must be able to see what the link grants without reading prose.
			credential: "one-time-pairing-secret",
			expiryEnforcedBy: "machine",
		});
		expect(formatHandoffJson(result)).not.toContain("privateKey");
	});

	it("omits sessionId from JSON when no session was handed off", async () => {
		const result = await runHandoff(
			{},
			deps({ latestSessionId: async () => undefined }),
		);
		expect(JSON.parse(formatHandoffJson(result)).sessionId).toBeUndefined();
	});
});
