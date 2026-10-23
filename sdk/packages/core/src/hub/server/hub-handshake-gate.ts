/**
 * Holds a websocket between "upgraded" and "authenticated".
 *
 * The token subprotocol proves who a client is *during* the HTTP upgrade, so the
 * hub can attach a freshly upgraded socket to the protocol adapter immediately.
 * A pairing or device-session handshake cannot: it needs a round trip of frames
 * on the open socket first. That leaves a window in which frames arrive but there
 * is nothing to route them to, and dropping them would make the phone's very
 * first hub command vanish.
 *
 * The gate registers the single `message` listener at upgrade time, queues
 * whatever arrives, hands the first frame to the handshake, and then pipes the
 * queue (in order) into the adapter once the socket is authenticated. Nothing is
 * dropped and nothing is delivered twice.
 */

import { HUB_HANDSHAKE_MAX_WIRE_BYTES } from "@cline/hub-pairing";

/** How many frames a client may pipeline before its handshake completes. */
const MAX_QUEUED_FRAMES = 32;

export interface GateSocketLike {
	on(event: "message", listener: (data: unknown) => void): void;
	terminate?(): void;
}

export interface HandshakeGate {
	/**
	 * The first frame the client sends, or a rejection if the socket closes or
	 * `timeoutMs` elapses first.
	 */
	firstFrame(timeoutMs: number): Promise<string>;
	/**
	 * Routes every frame — the ones already queued first, in arrival order — to
	 * `sink`. Called once the handshake succeeded.
	 */
	pipe(sink: (text: string) => void): void;
	/** Stops delivering anything; used when the handshake is refused. */
	abandon(): void;
	/** Called on socket close so a pending `firstFrame` rejects instead of hanging. */
	closed(): void;
}

export function createHandshakeGate(
	socket: GateSocketLike,
	decode: (data: unknown) => string,
	onOverflow: () => void,
): HandshakeGate {
	const queued: string[] = [];
	let sink: ((text: string) => void) | undefined;
	let waiting: ((text: string) => void) | undefined;
	let abandoned = false;
	let onClosed: (() => void) | undefined;
	let queuedBytes = 0;
	const overflow = (): void => {
		abandoned = true;
		queued.length = 0;
		queuedBytes = 0;
		onOverflow();
	};

	socket.on("message", (data: unknown) => {
		if (abandoned) {
			return;
		}
		let text: string;
		try {
			text = decode(data);
		} catch {
			return;
		}
		if (!sink && text.length + queuedBytes > HUB_HANDSHAKE_MAX_WIRE_BYTES) {
			overflow();
			return;
		}
		if (waiting) {
			const resume = waiting;
			waiting = undefined;
			resume(text);
			return;
		}
		if (sink) {
			sink(text);
			return;
		}
		if (queued.length >= MAX_QUEUED_FRAMES) {
			// A client flooding an unauthenticated socket gets nothing buffered on its
			// behalf: this is pre-auth memory, so the cap is a refusal, not a backlog.
			overflow();
			return;
		}
		queued.push(text);
		queuedBytes += text.length;
	});

	return {
		firstFrame(timeoutMs) {
			return new Promise<string>((resolve, reject) => {
				const first = queued.shift();
				if (first !== undefined) {
					queuedBytes -= first.length;
					resolve(first);
					return;
				}
				const timer = setTimeout(() => {
					waiting = undefined;
					onClosed = undefined;
					reject(new Error("handshake_timeout"));
				}, timeoutMs);
				timer.unref?.();
				waiting = (text) => {
					clearTimeout(timer);
					onClosed = undefined;
					resolve(text);
				};
				onClosed = () => {
					clearTimeout(timer);
					waiting = undefined;
					reject(new Error("handshake_socket_closed"));
				};
			});
		},
		pipe(next) {
			sink = next;
			while (queued.length > 0 && sink === next) {
				const text = queued.shift() as string;
				queuedBytes -= text.length;
				next(text);
			}
		},
		abandon() {
			abandoned = true;
			sink = undefined;
			queued.length = 0;
			queuedBytes = 0;
		},
		closed() {
			onClosed?.();
			onClosed = undefined;
		},
	};
}
