/**
 * Frame recorder.
 *
 * Taps the socket rather than the client: `HubClient` accepts a `WebSocketImpl`,
 * so wrapping that constructor captures every frame in true wire order —
 * including frames the client drops or ignores — without touching hub-client.
 */

import type { WebSocketCtor, WebSocketLike } from "@cline/hub-client";
import type { FrameDirection, RecordedFrame } from "./canonicalize";

export interface FrameRecorder {
	/** Frames captured so far, in wire order. */
	frames(): RecordedFrame[];
	/** Frames that could not be parsed as JSON, if any. */
	malformed(): Array<{ direction: FrameDirection; text: string }>;
	clear(): void;
	/** A `WebSocketImpl` that records everything crossing it. */
	socketCtor(): WebSocketCtor;
}

function parseFrame(text: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function decodeText(data: unknown): string | undefined {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return new TextDecoder().decode(data);
	}
	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(data));
	}
	if (data && typeof data === "object" && "data" in data) {
		return decodeText((data as { data: unknown }).data);
	}
	return undefined;
}

export function createFrameRecorder(base?: WebSocketCtor): FrameRecorder {
	const frames: RecordedFrame[] = [];
	const malformed: Array<{ direction: FrameDirection; text: string }> = [];

	const record = (direction: FrameDirection, data: unknown): void => {
		const text = decodeText(data);
		if (text === undefined) {
			return;
		}
		const frame = parseFrame(text);
		if (!frame) {
			malformed.push({ direction, text });
			return;
		}
		frames.push({ direction, frame });
	};

	const resolveBase = (): WebSocketCtor => {
		const ctor =
			base ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
		if (!ctor) {
			throw new Error("No WebSocket implementation available to record.");
		}
		return ctor;
	};

	class RecordingSocket implements WebSocketLike {
		private readonly inner: WebSocketLike;

		constructor(url: string, protocols?: string | string[], options?: unknown) {
			const Base = resolveBase() as unknown as new (
				url: string,
				protocols?: string | string[],
				options?: unknown,
			) => WebSocketLike;
			this.inner = options
				? new Base(url, protocols, options)
				: protocols
					? new Base(url, protocols)
					: new Base(url);
		}

		get readyState(): number {
			return this.inner.readyState;
		}

		send(data: string): void {
			record("out", data);
			this.inner.send(data);
		}

		close(): void {
			this.inner.close();
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			if (type !== "message") {
				this.inner.addEventListener(type, listener);
				return;
			}
			this.inner.addEventListener("message", (event: unknown) => {
				record("in", event);
				listener(event);
			});
		}
	}

	return {
		frames: () => [...frames],
		malformed: () => [...malformed],
		clear: () => {
			frames.length = 0;
			malformed.length = 0;
		},
		socketCtor: () => RecordingSocket as unknown as WebSocketCtor,
	};
}
