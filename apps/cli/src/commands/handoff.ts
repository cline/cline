/**
 * Machine-initiated handoff: the one step a user takes when they stand up from
 * the keyboard and want the session they are already in on their phone.
 *
 * The design point is that the machine answers the question the user should never
 * have to ("where is my computer, and which session was I in?"). It stamps the
 * *current* session id into a `clinecode://handoff` link and shows a QR plus a
 * copyable deep link. The host dials the relay outbound and keeps the local hub
 * behind that encrypted, authenticated tunnel.
 *
 * `s` is a single-use Noise PSK — never the hub token. The machine publishes the
 * matching offer into its private pairing directory. The running hub consumes a
 * direct offer; the detached outbound relay companion consumes an anywhere offer.
 * Both pin the new device key in the same allowlist and enforce the printed TTL
 * on this machine.
 *
 * Two transports:
 *
 * - `hub` (default): `u` is the hub's own websocket url. The phone opens
 *   `cline-hub-pair.v2.<offerId>` against it and is enrolled by the hub itself.
 *   Nothing outside the machine is involved, and no Cline account is needed.
 * - `relay` (`--relay`): `u` is the account relay. The machine dials out and
 *   bridges to its local hub; used when the phone is not on the same network.
 *
 * This module is the single implementation behind both entry points — the `/handoff`
 * slash command in the TUI and `cline hub share` — so the two can never drift on
 * URI shape, machine naming or expiry.
 */
import { hostname } from "node:os";
import {
	createPairingOffer,
	type DeviceKeyPair,
	type DeviceRegistry,
	deviceFingerprint,
	encodePairingUri,
	type PairingOffer,
} from "@cline/hub-pairing";
import type {
	StartedRelayHandoff,
	StartRelayHandoffInput,
} from "./handoff-relay";
import { renderQrCode, renderQrCodeBlockLines } from "./qr-code";

/**
 * Two minutes: long enough to unlock a phone and open the app, short enough that a
 * QR left on a screen after the user walks away is already stale. Advisory only —
 * see the note at the top of this file.
 */
export const DEFAULT_HANDOFF_TTL_MS = 120_000;

/** Hostnames that tell the phone nothing; better to say "This machine". */
const USELESS_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".localdomain", ".internal"];

export interface HandoffDeps {
	readonly now?: () => number;
	readonly hostname?: () => string;
	readonly loadIdentity?: () => Promise<DeviceKeyPair>;
	/** Hub url + credential the phone needs; `undefined` when the hub is down. */
	readonly readHubEndpoint?: () => Promise<HubEndpoint | undefined>;
	/** Used only when the caller did not pin a session. */
	readonly latestSessionId?: () => Promise<string | undefined>;
	readonly openDeviceRegistry?: () => Promise<DeviceRegistry>;
	/**
	 * Persists the minted offer where the running hub will find it. This is the
	 * whole handover: after it resolves, the phone can present the offer's secret
	 * to the hub and be enrolled.
	 */
	readonly publishPairingOffer?: (offer: PairingOffer) => Promise<void>;
	readonly startRelayHandoff?: (
		input: StartRelayHandoffInput,
	) => Promise<StartedRelayHandoff>;
	/** Signed-in entry points default to the anywhere transport. */
	readonly shouldUseRelay?: () => Promise<boolean>;
}

export interface HubEndpoint {
	readonly url: string;
	/** The hub's own auth token, presented by the phone verbatim. */
	readonly authToken?: string;
}

export interface HandoffInput {
	/**
	 * Session the phone should open. The TUI passes the session the user is looking
	 * at; `cline hub share` passes `--session` or falls back to the newest one.
	 */
	readonly sessionId?: string;
	/** `--name`; defaults to a cleaned-up hostname. */
	readonly machineName?: string;
	readonly ttlMs?: number;
	/**
	 * Route the phone through the account relay instead of the hub's own address.
	 * Needed when the phone is not on the same network as the machine; costs a
	 * Cline account and a dial-out.
	 */
	readonly viaRelay?: boolean;
}

export interface HandoffResult {
	readonly uri: string;
	readonly machineName: string;
	/** The address in the link: the hub's own url, or the relay's. */
	readonly hubUrl: string;
	readonly sessionId?: string;
	readonly expiresAt: number;
	readonly ttlMs: number;
	readonly fingerprint: string;
	/** Which of the two transports the link points at. */
	readonly transport: "hub" | "relay";
	readonly offerId: string;
}

/**
 * `os.hostname()` is the machine's network name, which on macOS is the friendly
 * name with the spaces hyphenated and a local domain glued on. Undo both so the
 * phone can show "Examples MacBook Pro" rather than an address. Capitalisation is
 * left alone: the host already carries it, and re-casing would mangle names like
 * "iMac" or "build-box-01".
 */
export function cleanMachineName(raw: string): string {
	let name = raw.trim();
	for (const suffix of LOCAL_SUFFIXES) {
		if (name.toLowerCase().endsWith(suffix)) {
			name = name.slice(0, -suffix.length);
			break;
		}
	}
	name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	if (!name || USELESS_HOSTNAMES.has(name.toLowerCase())) {
		return "This machine";
	}
	return sanitizeMachineName(name);
}

/**
 * Keeps the display name to characters that survive a deep link intact.
 *
 * The phone's router re-joins the query from already-decoded values, so a name
 * containing `&`, `=`, `#`, `?` or `%` would swallow or corrupt the parameters that
 * follow it, and a literal `+` would arrive as a space. Dropping those characters
 * costs a little fidelity in a label and removes a whole class of "the link works
 * except on that one machine" bug. Control characters go too: a name is a label,
 * not a place to smuggle escapes into someone's terminal.
 */
export function sanitizeMachineName(raw: string): string {
	const cleaned = raw
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[&=#?%+/\\]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 64)
		.trim();
	return cleaned || "This machine";
}

/** Whole minutes read better on a QR someone is staring at; anything else in seconds. */
export function formatHandoffExpiry(ttlMs: number): string {
	const seconds = Math.max(1, Math.round(ttlMs / 1000));
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
	}
	return `${seconds} seconds`;
}

async function defaultLoadIdentity(): Promise<DeviceKeyPair> {
	// Dynamic so this module does not form an import cycle with `hub.ts`, which
	// owns the 0600 identity file and imports the handoff flow for `hub share`.
	const { loadOrCreateHubIdentity } = await import("./hub");
	return await loadOrCreateHubIdentity();
}

async function defaultReadHubEndpoint(): Promise<HubEndpoint | undefined> {
	const [{ readHubDiscovery }, { resolveCliHubOwnerContext }] =
		await Promise.all([import("@cline/core"), import("./hub")]);
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	return discovery?.url
		? { url: discovery.url, authToken: discovery.authToken }
		: undefined;
}

async function defaultLatestSessionId(): Promise<string | undefined> {
	// Imported lazily: the session backend pulls in a large graph that the pairing
	// commands otherwise never need.
	const { listSessions } = await import("../session/session");
	const [latest] = await listSessions(1);
	// The same id `session.list` reports over the hub, which is what the phone
	// routes on.
	return latest?.sessionId;
}

async function defaultOpenDeviceRegistry(): Promise<DeviceRegistry> {
	const { openDeviceRegistry } = await import("./hub");
	return await openDeviceRegistry();
}

async function defaultPublishPairingOffer(offer: PairingOffer): Promise<void> {
	// Dynamic for the same reason as `defaultLoadIdentity`: `hub.ts` imports this
	// module for `hub share`.
	const { writePairingOffer } = await import("@cline/core/hub/pairing");
	await writePairingOffer(offer);
}

async function defaultStartRelayHandoff(
	input: StartRelayHandoffInput,
): Promise<StartedRelayHandoff> {
	const { startRelayHandoff } = await import("./handoff-relay");
	return await startRelayHandoff(input);
}

export async function runHandoff(
	input: HandoffInput,
	deps: HandoffDeps = {},
): Promise<HandoffResult> {
	const now = deps.now ?? Date.now;
	const endpoint = await (deps.readHubEndpoint ?? defaultReadHubEndpoint)();
	if (!endpoint?.url) {
		throw new Error(
			"The hub is not running, so a phone would have nothing to connect to. Start it with `cline hub start` first.",
		);
	}
	const identity = await (deps.loadIdentity ?? defaultLoadIdentity)();
	const machineName = input.machineName?.trim()
		? sanitizeMachineName(input.machineName)
		: cleanMachineName((deps.hostname ?? hostname)());
	const sessionId =
		input.sessionId?.trim() ||
		(await (deps.latestSessionId ?? defaultLatestSessionId)())?.trim() ||
		undefined;
	const ttlMs = input.ttlMs ?? DEFAULT_HANDOFF_TTL_MS;
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) {
		throw new Error(
			"Handoff TTL must be a whole number of milliseconds (at least 1000).",
		);
	}
	const fingerprint = deviceFingerprint(identity.publicKey);

	if (input.viaRelay) {
		if (!endpoint.authToken) {
			// The relay bridge dials the *local* hub with the token on the machine's
			// behalf, so without it there is nothing to bridge to.
			throw new Error(
				"The hub is running but did not publish an auth token, so the relay bridge could not reach it. Restart it with `cline hub stop && cline hub start`.",
			);
		}
		const registry = await (
			deps.openDeviceRegistry ?? defaultOpenDeviceRegistry
		)();
		const started = await (deps.startRelayHandoff ?? defaultStartRelayHandoff)({
			identity,
			registry,
			hubUrl: endpoint.url,
			hubAuthToken: endpoint.authToken,
			machineName,
			ttlMs,
			now,
			...(sessionId ? { sessionId } : {}),
		});
		return {
			uri: started.uri,
			machineName,
			hubUrl: started.relayUrl,
			sessionId,
			expiresAt: started.expiresAt,
			ttlMs,
			fingerprint,
			transport: "relay",
			offerId: started.offerId,
		};
	}

	// The default: point the phone straight at this machine's hub and leave the
	// offer where the hub will find it. No token in the link, no account, no relay.
	const created = createPairingOffer({
		hubPublicKey: identity.publicKey,
		hubName: machineName,
		url: endpoint.url,
		ttlMs,
		now,
		...(sessionId ? { sessionId } : {}),
	});
	await (deps.publishPairingOffer ?? defaultPublishPairingOffer)(created.offer);
	return {
		uri: encodePairingUri(created.offer, { format: "handoff" }),
		machineName,
		hubUrl: endpoint.url,
		sessionId,
		expiresAt: created.expiresAt,
		ttlMs,
		fingerprint,
		transport: "hub",
		offerId: created.offer.offerId,
	};
}

/**
 * The `/handoff` entry point. `getSessionId` is read at call time, not at wiring
 * time, because the active session changes underneath the TUI (`/clear`, `/fork`,
 * `/history`) and the handoff must land the phone in the session on screen now.
 */
export function createSessionHandoffRunner(
	getSessionId: () => string | undefined,
	deps: HandoffDeps = {},
): (input?: HandoffInput) => Promise<HandoffResult> {
	return async (input: HandoffInput = {}) => {
		const viaRelay =
			input.viaRelay ??
			(await (
				deps.shouldUseRelay ??
				(async () => {
					const { hasRelayAccount } = await import("./handoff-relay");
					return hasRelayAccount();
				})
			)());
		return await runHandoff(
			{ ...input, viaRelay, sessionId: input.sessionId ?? getSessionId() },
			{
				...deps,
				// With no active session there is nothing to pin: fall through to the
				// phone's session list rather than handing off some unrelated session.
				latestSessionId: async () => undefined,
			},
		);
	};
}

export interface HandoffPresentation {
	readonly result: HandoffResult;
	readonly headline: string;
	readonly instruction: string;
	readonly uri: string;
	/** Half-block QR rows with no ANSI, so the TUI can apply its own colours. */
	readonly qrBlockLines: string[];
	readonly details: string[];
}

export function buildHandoffPresentation(
	result: HandoffResult,
): HandoffPresentation {
	const details = [
		result.sessionId
			? `Session ${result.sessionId} opens on the phone.`
			: "No session pinned — the phone will open its session list.",
		`Pairing code expires in ${formatHandoffExpiry(result.ttlMs)} and can be used once. This machine enforces both.`,
		result.transport === "relay"
			? "Your hub token stays on this machine; the relay carries only end-to-end encrypted session data."
			: `Your hub token stays on this machine — the code pairs a device instead. The phone must be able to reach ${result.hubUrl}.`,
		`This machine's fingerprint: ${result.fingerprint}`,
	];
	return {
		result,
		headline: `Hand off to your phone — ${result.machineName}`,
		instruction: "Scan this with Cline Code on your phone.",
		uri: result.uri,
		qrBlockLines: renderQrCodeBlockLines(result.uri),
		details,
	};
}

/** Rows the handoff dialog spends on text, borders and padding around the QR. */
const HANDOFF_CHROME_ROWS = 13;

/**
 * A QR taller than the window is worse than no QR: it renders clipped, which
 * cannot be scanned but looks like it should be. Callers that draw into a fixed
 * viewport (the TUI dialog) ask first and fall back to the copyable link.
 */
export function handoffQrFitsIn(
	presentation: HandoffPresentation,
	availableRows: number,
): boolean {
	return (
		presentation.qrBlockLines.length + HANDOFF_CHROME_ROWS <= availableRows
	);
}

/**
 * Terminal rendering shared by `cline hub share`. The URI is printed alone on its
 * line, unindented and unwrapped, because it is the fallback path: a short code
 * would be friendlier, but a short code needs a rendezvous service to resolve it
 * against and there is none yet, so copy/paste of the full link is the honest
 * fallback until the relay lands.
 */
export function formatHandoffTerminalLines(
	presentation: HandoffPresentation,
): string[] {
	return [
		"",
		presentation.headline,
		"",
		...renderQrCode(presentation.uri),
		"",
		presentation.instruction,
		presentation.uri,
		"",
		...presentation.details,
	];
}

export function formatHandoffJson(result: HandoffResult): string {
	return JSON.stringify({
		uri: result.uri,
		hubName: result.machineName,
		hubUrl: result.hubUrl,
		...(result.sessionId ? { sessionId: result.sessionId } : {}),
		hubFingerprint: result.fingerprint,
		offerId: result.offerId,
		transport: result.transport,
		expiresAt: new Date(result.expiresAt).toISOString(),
		expiresInMs: result.ttlMs,
		credential: "one-time-pairing-secret",
		// Not advisory: the component that consumes the offer refuses it past this
		// point on its own clock.
		expiryEnforcedBy: "machine",
	});
}
