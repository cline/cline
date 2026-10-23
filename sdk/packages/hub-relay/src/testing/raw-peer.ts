/**
 * A raw relay peer for tests: speaks the relay wire protocol directly, with no
 * host client and no hub, so protocol-level refusals (bad seq, oversized payload,
 * cross-account routing, upgrade rejections) are reachable.
 */

import { WebSocket } from "ws";
import {
	decodeRelayFrame,
	encodeRelayAuthCredential,
	encodeRelayFrame,
	type RelayAuthMode,
	type RelayFrame,
	relayClientUrl,
	relayFrameCapBytes,
	relayHostUrl,
} from "../protocol/index";

export interface RawPeerCloseInfo {
	code: number;
	reason: string;
}

export interface RawRelayPeer {
	readonly socket: WebSocket;
	send(frame: RelayFrame): void;
	sendRaw(text: string): void;
	frames(): RelayFrame[];
	framesOfType<T extends RelayFrame["t"]>(
		type: T,
	): Extract<RelayFrame, { t: T }>[];
	waitFor<T extends RelayFrame["t"]>(
		type: T,
		predicate?: (frame: Extract<RelayFrame, { t: T }>) => boolean,
	): Promise<Extract<RelayFrame, { t: T }>>;
	waitForClose(): Promise<RawPeerCloseInfo>;
	closeInfo(): RawPeerCloseInfo | undefined;
	close(): void;
}

export interface ConnectRawPeerOptions {
	relayUrl: string;
	role: "host" | "client";
	token: string;
	authMode?: RelayAuthMode;
	/** Skip the `Authorization` header and the auth subprotocol entirely. */
	omitAuth?: boolean;
	/** Matches the relay under test when it is configured with a larger cap. */
	maxPayloadBytes?: number;
}

const WAIT_TIMEOUT_MS = 10_000;

export async function connectRawPeer(
	options: ConnectRawPeerOptions,
): Promise<RawRelayPeer> {
	const authMode: RelayAuthMode = options.authMode ?? "bearer-header";
	const url =
		options.role === "host"
			? relayHostUrl(options.relayUrl)
			: relayClientUrl(options.relayUrl);
	const protocols =
		!options.omitAuth && authMode === "relay-subprotocol"
			? [encodeRelayAuthCredential(options.token)]
			: undefined;
	const headers: Record<string, string> = {};
	if (!options.omitAuth && authMode === "bearer-header") {
		headers.Authorization = `Bearer ${options.token}`;
	}
	const decodeOptions = options.maxPayloadBytes
		? { maxPayloadBytes: options.maxPayloadBytes }
		: {};
	const socket = new WebSocket(url, protocols, {
		headers,
		...(options.maxPayloadBytes
			? { maxPayload: relayFrameCapBytes(options.maxPayloadBytes) }
			: {}),
	});

	const received: RelayFrame[] = [];
	const waiters = new Set<() => void>();
	let closeInfo: RawPeerCloseInfo | undefined;

	const notify = (): void => {
		for (const waiter of [...waiters]) {
			waiter();
		}
	};

	socket.on("message", (raw: unknown) => {
		const decoded = decodeRelayFrame(String(raw), decodeOptions);
		if (decoded.ok) {
			received.push(decoded.frame);
			notify();
		}
	});
	socket.on("close", (code: number, reason: Buffer) => {
		closeInfo = { code, reason: reason.toString("utf8") };
		notify();
	});
	// `ws` throws on an unhandled `error`; upgrade failures surface via the
	// `open`/`error` race below.
	socket.on("error", () => {});

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`raw peer never opened: ${url}`)),
			WAIT_TIMEOUT_MS,
		);
		socket.once("open", () => {
			clearTimeout(timer);
			resolve();
		});
		socket.once("error", (error: Error) => {
			clearTimeout(timer);
			reject(error);
		});
	});

	const peer: RawRelayPeer = {
		socket,
		send: (frame) => socket.send(encodeRelayFrame(frame)),
		sendRaw: (text) => socket.send(text),
		frames: () => [...received],
		framesOfType: <T extends RelayFrame["t"]>(type: T) =>
			received.filter(
				(frame): frame is Extract<RelayFrame, { t: T }> => frame.t === type,
			),
		waitFor: <T extends RelayFrame["t"]>(
			type: T,
			predicate?: (frame: Extract<RelayFrame, { t: T }>) => boolean,
		) =>
			new Promise<Extract<RelayFrame, { t: T }>>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(check);
					reject(
						new Error(
							`timed out waiting for ${type}; saw [${received.map((frame) => frame.t).join(", ")}]${
								closeInfo
									? ` (closed ${closeInfo.code} ${closeInfo.reason})`
									: ""
							}`,
						),
					);
				}, WAIT_TIMEOUT_MS);
				function check(): void {
					const match = received.find(
						(frame): frame is Extract<RelayFrame, { t: T }> =>
							frame.t === type &&
							(!predicate || predicate(frame as Extract<RelayFrame, { t: T }>)),
					);
					if (!match) {
						return;
					}
					clearTimeout(timer);
					waiters.delete(check);
					resolve(match);
				}
				waiters.add(check);
				check();
			}),
		waitForClose: () =>
			new Promise<RawPeerCloseInfo>((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.delete(check);
					reject(new Error("timed out waiting for the socket to close"));
				}, WAIT_TIMEOUT_MS);
				function check(): void {
					if (!closeInfo) {
						return;
					}
					clearTimeout(timer);
					waiters.delete(check);
					resolve(closeInfo);
				}
				waiters.add(check);
				check();
			}),
		closeInfo: () => closeInfo,
		close: () => socket.close(),
	};
	return peer;
}

/**
 * A registered host that echoes every relayed payload straight back on the same
 * channel, with no hub involved. Proves the pipe carries bytes it cannot read.
 */
export async function connectEchoHost(options: {
	relayUrl: string;
	token: string;
	machineId: string;
	label?: string;
	maxPayloadBytes?: number;
}): Promise<RawRelayPeer & { machineId: string }> {
	const peer = await connectRawPeer({
		relayUrl: options.relayUrl,
		role: "host",
		token: options.token,
		...(options.maxPayloadBytes
			? { maxPayloadBytes: options.maxPayloadBytes }
			: {}),
	});
	const seqByChannel = new Map<string, number>();
	peer.socket.on("message", (raw: unknown) => {
		const decoded = decodeRelayFrame(String(raw), {
			...(options.maxPayloadBytes
				? { maxPayloadBytes: options.maxPayloadBytes }
				: {}),
		});
		if (!decoded.ok) {
			return;
		}
		if (decoded.frame.t === "channel.open") {
			// Stands in for "the local hub socket opened": the relay withholds
			// `client.connected` until a host confirms a channel is usable.
			peer.send({ t: "channel.ready", channelId: decoded.frame.channelId });
			return;
		}
		if (decoded.frame.t !== "data") {
			return;
		}
		const frame = decoded.frame;
		const seq = (seqByChannel.get(frame.channelId) ?? 0) + 1;
		seqByChannel.set(frame.channelId, seq);
		peer.send({
			t: "data",
			channelId: frame.channelId,
			seq,
			payload: frame.payload,
		});
	});
	peer.send({
		t: "host.register",
		protocolVersion: "relay-v1",
		machineId: options.machineId,
		...(options.label ? { label: options.label } : {}),
	});
	await peer.waitFor("host.registered");
	return { ...peer, machineId: options.machineId };
}
