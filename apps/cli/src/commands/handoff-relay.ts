import { ProviderSettingsManager } from "@cline/core";
import {
	deletePairingOffer,
	readPairingOffer,
	writePairingOffer,
} from "@cline/core/hub/pairing";
import {
	acceptDeviceSession,
	bytesToBase64Url,
	createHubPairingSession,
	createPairingOffer,
	type DeviceKeyPair,
	type DeviceRegistry,
	deviceIdFromPublicKey,
	encodePairingUri,
	PAIRING_PROTOCOL_VERSION,
} from "@cline/hub-pairing";
import {
	createRelayHostClient,
	type RelayHostClient,
	type RelayPayloadCodec,
} from "@cline/hub-relay";
import { getClineEnvironmentConfig } from "@cline/shared";
import { getPersistedProviderApiKey } from "../utils/provider-auth";

export interface StartRelayHandoffInput {
	identity: DeviceKeyPair;
	registry: DeviceRegistry;
	hubUrl: string;
	hubAuthToken: string;
	machineName: string;
	sessionId?: string;
	ttlMs: number;
	now: () => number;
	relayUrl?: string;
	apiBaseUrl?: string;
	/** Dev/test escape hatch: a relay credential accepted without core exchange. */
	accountToken?: string;
	fetchImpl?: typeof fetch;
}

export type PersistentRelayHostInput = Omit<
	StartRelayHandoffInput,
	"sessionId" | "ttlMs" | "now"
> & { now?: () => number };

export interface StartedRelayHandoff {
	uri: string;
	relayUrl: string;
	expiresAt: number;
	/** The offer the phone will present; reported so callers can name it. */
	offerId: string;
}

type PairingSession = ReturnType<typeof createHubPairingSession>;

interface RunningBridge {
	key: string;
	host: RelayHostClient;
	offers: Map<string, PairingSession>;
	persistedOffers: boolean;
	registry: DeviceRegistry;
	identity: DeviceKeyPair;
	stopRevocationWatch: () => void;
}

let running: RunningBridge | undefined;

function codec(channel: {
	encryptBytes(value: Uint8Array): Uint8Array;
	decryptBytes(value: Uint8Array): Uint8Array;
}): RelayPayloadCodec {
	return {
		seal: (value) => channel.encryptBytes(value),
		open: (value) => channel.decryptBytes(value),
	};
}

function defaultAccountToken(): string {
	const manager = new ProviderSettingsManager();
	const token = getPersistedProviderApiKey(
		"cline",
		manager.getProviderSettings("cline"),
	)?.trim();
	if (!token) {
		throw new Error(
			"Remote control needs your Cline account. Run `cline auth cline`, then try /handoff again.",
		);
	}
	return token;
}

export function hasRelayAccount(): boolean {
	try {
		return defaultAccountToken().length > 0;
	} catch {
		return false;
	}
}

function accountAuthorization(token: string): string {
	const normalized = token.startsWith("workos:") ? token : `workos:${token}`;
	return `Bearer ${normalized}`;
}

async function readCoreData(
	response: Response,
): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		const detail =
			body && typeof body === "object" && "error" in body
				? String((body as { error?: unknown }).error ?? "")
				: "";
		throw new Error(
			`Cline remote-access request failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}
	if (!body || typeof body !== "object") {
		throw new Error("Cline remote-access response was not JSON");
	}
	const data = (body as { data?: unknown }).data;
	if (!data || typeof data !== "object") {
		throw new Error("Cline remote-access response had no data");
	}
	return data as Record<string, unknown>;
}

async function registerRemoteMachine(input: {
	apiBaseUrl: string;
	accountToken: string;
	machineId: string;
	machineName: string;
	identityPublicKey: string;
	fetchImpl: typeof fetch;
}): Promise<void> {
	await readCoreData(
		await input.fetchImpl(`${input.apiBaseUrl}/api/v1/machines`, {
			method: "POST",
			headers: {
				Authorization: accountAuthorization(input.accountToken),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				machineId: input.machineId,
				label: input.machineName,
				identityPublicKey: input.identityPublicKey,
			}),
		}),
	);
}

async function requestHostRelayTicket(input: {
	apiBaseUrl: string;
	accountToken: string;
	machineId: string;
	fetchImpl: typeof fetch;
}): Promise<string> {
	const data = await readCoreData(
		await input.fetchImpl(
			`${input.apiBaseUrl}/api/v1/machines/${encodeURIComponent(input.machineId)}/relay-ticket`,
			{
				method: "POST",
				headers: {
					Authorization: accountAuthorization(input.accountToken),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ role: "host" }),
			},
		),
	);
	const token = typeof data.token === "string" ? data.token.trim() : "";
	if (!token) {
		throw new Error("Cline returned an unreadable host relay ticket");
	}
	return token;
}

async function ensureBridge(
	input: StartRelayHandoffInput & { persistedOffers?: boolean },
): Promise<RunningBridge> {
	const relayUrl = input.relayUrl ?? getClineEnvironmentConfig().relayBaseUrl;
	const environment = getClineEnvironmentConfig();
	const machineId = deviceIdFromPublicKey(input.identity.publicKey);
	const apiBaseUrl = input.apiBaseUrl ?? environment.apiBaseUrl;
	const fetchImpl = input.fetchImpl ?? fetch;
	const accountToken = input.accountToken ?? defaultAccountToken();
	const key = JSON.stringify([
		relayUrl,
		input.hubUrl,
		input.hubAuthToken,
		machineId,
		!!input.persistedOffers,
	]);
	if (running?.key === key && running.host.state() !== "closed") {
		return running;
	}
	if (running) {
		running.stopRevocationWatch();
		await running.host.close();
		running = undefined;
	}

	const offers = new Map<string, PairingSession>();
	const registry = input.registry;
	const identity = input.identity;
	const claimedPersistedOffers = new Set<string>();
	const loadPairingSession = async (
		offerId: string,
	): Promise<PairingSession | undefined> => {
		if (!input.persistedOffers) return offers.get(offerId);
		// Claim before the first await so two sockets cannot both read and consume
		// the same file-backed one-time offer.
		if (claimedPersistedOffers.has(offerId)) return undefined;
		claimedPersistedOffers.add(offerId);
		try {
			const offer = await readPairingOffer(offerId);
			if (!offer) claimedPersistedOffers.delete(offerId);
			return offer
				? createHubPairingSession(offer, identity.privateKey, {
						now: input.now,
					})
				: undefined;
		} catch (error) {
			claimedPersistedOffers.delete(offerId);
			throw error;
		}
	};
	if (!input.accountToken) {
		await registerRemoteMachine({
			apiBaseUrl,
			accountToken,
			machineId,
			machineName: input.machineName,
			identityPublicKey: bytesToBase64Url(input.identity.publicKey),
			fetchImpl,
		});
	}
	const host = createRelayHostClient({
		relayUrl,
		...(input.accountToken
			? { accountToken }
			: {
					getAccountToken: () =>
						requestHostRelayTicket({
							apiBaseUrl,
							accountToken,
							machineId,
							fetchImpl,
						}),
				}),
		hubUrl: input.hubUrl,
		hubAuthToken: input.hubAuthToken,
		machineId,
		label: input.machineName,
		secureHandshake: {
			async accept(handshake) {
				if (handshake.kind === "pairing") {
					const offerId = handshake.offerId?.trim();
					const pending = offerId
						? await loadPairingSession(offerId)
						: undefined;
					if (!offerId || !pending) {
						throw new Error(
							"pairing offer is unknown, expired, or already used",
						);
					}
					let completed: ReturnType<PairingSession["complete"]>;
					try {
						completed = pending.complete({
							version: PAIRING_PROTOCOL_VERSION,
							offerId,
							message: handshake.message,
						});
					} catch (error) {
						if (input.persistedOffers) claimedPersistedOffers.delete(offerId);
						throw error;
					}
					if (input.persistedOffers) {
						await deletePairingOffer(offerId);
					} else {
						offers.delete(offerId);
					}
					const record = await registry.add({
						publicKey: completed.device.publicKey,
						label: completed.device.label,
						...(completed.device.platform
							? { platform: completed.device.platform }
							: {}),
					});
					const unbindTunnel = registry.bindChannel(record.deviceId, {
						get closed() {
							return completed.channel.closed;
						},
						close: handshake.close,
					});
					return {
						response: completed.response.message,
						payloadCodec: codec(completed.channel),
						release: () => {
							unbindTunnel();
							completed.channel.close();
						},
					};
				}

				const accepted = acceptDeviceSession({
					hubPrivateKey: identity.privateKey,
					registry,
					message: handshake.message,
				});
				const unbindTunnel = registry.bindChannel(accepted.device.deviceId, {
					get closed() {
						return accepted.channel.closed;
					},
					close: handshake.close,
				});
				return {
					response: accepted.message,
					payloadCodec: codec(accepted.channel),
					release: () => {
						unbindTunnel();
						accepted.release();
						accepted.channel.close();
					},
				};
			},
		},
	});
	await host.start();
	running = {
		key,
		host,
		offers,
		persistedOffers: !!input.persistedOffers,
		registry,
		identity,
		stopRevocationWatch: registry.startRevocationWatch(),
	};
	return running;
}

export async function startRelayHandoff(
	input: StartRelayHandoffInput,
): Promise<StartedRelayHandoff> {
	if (!input.accountToken) {
		const relayUrl = input.relayUrl ?? getClineEnvironmentConfig().relayBaseUrl;
		const created = createPairingOffer({
			hubPublicKey: input.identity.publicKey,
			hubName: input.machineName,
			url: relayUrl,
			ttlMs: input.ttlMs,
			now: input.now,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
		});
		await writePairingOffer(created.offer);
		try {
			const { ensureRemoteHostProcess } = await import(
				"./remote-host-lifecycle"
			);
			await ensureRemoteHostProcess({ machineName: input.machineName });
		} catch (error) {
			await deletePairingOffer(created.offer.offerId).catch(() => undefined);
			throw error;
		}
		const remaining = Math.max(0, created.expiresAt - input.now());
		const timer = setTimeout(() => {
			void deletePairingOffer(created.offer.offerId).catch(() => undefined);
		}, remaining + 1);
		timer.unref?.();
		return {
			uri: encodePairingUri(created.offer, { format: "handoff" }),
			relayUrl,
			expiresAt: created.expiresAt,
			offerId: created.offer.offerId,
		};
	}
	const bridge = await ensureBridge(input);
	const relayUrl = input.relayUrl ?? getClineEnvironmentConfig().relayBaseUrl;
	const created = createPairingOffer({
		hubPublicKey: input.identity.publicKey,
		hubName: input.machineName,
		url: relayUrl,
		ttlMs: input.ttlMs,
		now: input.now,
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
	});
	bridge.offers.set(
		created.offer.offerId,
		createHubPairingSession(created.offer, input.identity.privateKey, {
			now: input.now,
		}),
	);
	const remaining = Math.max(0, created.expiresAt - input.now());
	const timer = setTimeout(() => {
		bridge.offers.delete(created.offer.offerId);
	}, remaining + 1);
	timer.unref?.();
	return {
		uri: encodePairingUri(created.offer, { format: "handoff" }),
		relayUrl,
		expiresAt: created.expiresAt,
		offerId: created.offer.offerId,
	};
}

/** Starts the long-lived, file-backed relay bridge owned by the CLI companion. */
export async function startPersistentRelayHost(
	input: PersistentRelayHostInput,
): Promise<{
	close(): Promise<void>;
	state(): ReturnType<RelayHostClient["state"]>;
}> {
	const bridge = await ensureBridge({
		...input,
		ttlMs: 1_000,
		now: input.now ?? Date.now,
		persistedOffers: true,
	});
	return {
		close: () => bridge.host.close(),
		state: () => bridge.host.state(),
	};
}
