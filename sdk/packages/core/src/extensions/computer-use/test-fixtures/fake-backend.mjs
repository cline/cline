// Minimal computer-use backend for tests: answers every request line with a
// get_display_info response. Usage: node fake-backend.mjs <port> [lifetimeMs] [startupDelayMs] [pidFile] [silent]
// (exits itself after lifetimeMs, so tests never leak it).

import { writeFileSync } from "node:fs";
import net from "node:net";

const port = Number.parseInt(process.argv[2] ?? "0", 10);
const lifetimeMs = Number.parseInt(process.argv[3] ?? "0", 10);
const startupDelayMs = Number.parseInt(process.argv[4] ?? "0", 10);
if (process.argv[5]) writeFileSync(process.argv[5], String(process.pid));
const server = net.createServer((socket) => {
	socket.on("error", () => {});
	let buffer = "";
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
			const shuttingDown = request.action === "shutdown_backend";
			const displayBroken =
				process.argv.includes("display-error") &&
				request.action === "get_display_info";
			const ignoreShutdown = process.argv.includes("ignore-shutdown");
			socket.write(
				`${JSON.stringify({
					id: request.id,
					ok: !displayBroken,
					...(displayBroken ? { error: "screen handle is invalid" } : {}),
					...(shuttingDown ? {} : { display: { widthPx: 100, heightPx: 100 } }),
				})}\n`,
				() => {
					if (shuttingDown && !ignoreShutdown)
						server.close(() => process.exit(0));
				},
			);
		}
	});
});
setTimeout(() => server.listen(port, "127.0.0.1"), startupDelayMs);
if (lifetimeMs > 0) {
	setTimeout(() => process.exit(0), lifetimeMs).unref();
}
