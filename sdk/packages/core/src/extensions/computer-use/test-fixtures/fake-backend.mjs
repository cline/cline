// Minimal computer-use backend for tests. Like qbt, ordinary requests queue
// per connection; only a first-frame shutdown bypasses the action queue.
// Usage: node fake-backend.mjs <port> [lifetimeMs] [startupDelayMs] [pidFile] [silent]
// Optional flags: display-error, ignore-shutdown, wait-file=<path>.

import { writeFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const port = Number.parseInt(process.argv[2] ?? "0", 10);
const lifetimeMs = Number.parseInt(process.argv[3] ?? "0", 10);
const startupDelayMs = Number.parseInt(process.argv[4] ?? "0", 10);
if (process.argv[5]) writeFileSync(process.argv[5], String(process.pid));
const waitFile = process.argv
	.find((argument) => argument.startsWith("wait-file="))
	?.slice("wait-file=".length);
const sockets = new Set();
const server = net.createServer((socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
	socket.on("error", () => {});
	let buffer = "";
	let firstRequest = true;
	let queue = Promise.resolve();
	const respond = (request, stopBackend = false) => {
		const displayBroken =
			process.argv.includes("display-error") &&
			request.action === "get_display_info";
		socket.write(
			`${JSON.stringify({
				id: request.id,
				ok: !displayBroken,
				...(displayBroken ? { error: "screen handle is invalid" } : {}),
				...(request.action === "shutdown_backend"
					? {}
					: { display: { widthPx: 100, heightPx: 100 } }),
			})}\n`,
			() => {
				if (stopBackend && !process.argv.includes("ignore-shutdown")) {
					server.close(() => process.exit(0));
					for (const connection of sockets) connection.destroy();
				}
			},
		);
	};
	socket.on("data", (chunk) => {
		if (process.argv[6] === "silent") return;
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			const request = JSON.parse(line);
			const controlShutdown =
				firstRequest && request.action === "shutdown_backend";
			firstRequest = false;
			if (controlShutdown) {
				respond(request, true);
				continue;
			}
			queue = queue.then(async () => {
				if (request.action === "wait") {
					if (waitFile) writeFileSync(waitFile, "waiting");
					await delay(request.durationSeconds * 1_000);
				}
				if (!socket.destroyed) respond(request);
			});
		}
	});
});
setTimeout(() => server.listen(port, "127.0.0.1"), startupDelayMs);
if (lifetimeMs > 0) {
	setTimeout(() => process.exit(0), lifetimeMs).unref();
}
