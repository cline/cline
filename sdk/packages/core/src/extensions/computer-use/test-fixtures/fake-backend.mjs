// Minimal computer-use backend for tests: answers every request line with a
// get_display_info response. Usage: node fake-backend.mjs <port> [lifetimeMs]
// (exits itself after lifetimeMs, so tests never leak it).
import net from "node:net";

const port = Number.parseInt(process.argv[2] ?? "0", 10);
const lifetimeMs = Number.parseInt(process.argv[3] ?? "0", 10);
const server = net.createServer((socket) => {
	let buffer = "";
	socket.on("data", (chunk) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			const request = JSON.parse(line);
			socket.write(
				`${JSON.stringify({
					id: request.id,
					ok: true,
					display: { widthPx: 100, heightPx: 100 },
				})}\n`,
			);
		}
	});
});
server.listen(port, "127.0.0.1");
if (lifetimeMs > 0) {
	setTimeout(() => process.exit(0), lifetimeMs).unref();
}
