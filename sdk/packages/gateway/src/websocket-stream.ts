import { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";

/**
 * Adapt a `ws` socket to the Gateway's NDJSON duplex transport.
 *
 * Bun exposes a compatibility `ws` module but does not implement
 * `createWebSocketStream`, so the Gateway owns this small transport adapter.
 */
export function createGatewayWebSocketStream(socket: WebSocket): Duplex {
	const stream = new Duplex({
		read() {},
		write(chunk, _encoding, callback) {
			if (socket.readyState !== socket.OPEN) {
				callback(new Error("WebSocket is not open"));
				return;
			}
			socket.send(chunk, callback);
		},
		final(callback) {
			if (socket.readyState === socket.CLOSED) {
				callback();
				return;
			}
			socket.once("close", () => callback());
			socket.close();
		},
		destroy(error, callback) {
			if (
				socket.readyState === socket.OPEN ||
				socket.readyState === socket.CONNECTING
			) {
				socket.terminate();
			}
			callback(error);
		},
	});

	socket.on("message", (data: RawData) => {
		stream.push(toBuffer(data));
	});
	socket.once("close", () => stream.push(null));
	socket.once("error", (error: Error) => stream.destroy(error));
	return stream;
}

function toBuffer(data: RawData): Buffer {
	if (Array.isArray(data)) return Buffer.concat(data);
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
