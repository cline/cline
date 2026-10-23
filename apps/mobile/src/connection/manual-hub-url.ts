export type ManualHubUrlResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

/**
 * Manual token connections may use plaintext WebSockets only on loopback.
 * LAN pairing is a separate E2E-encrypted path reached through `/handoff`.
 */
export function validateManualHubUrl(input: string): ManualHubUrlResult {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		return { ok: false, message: "Enter a valid WebSocket URL." };
	}
	if (parsed.username || parsed.password) {
		return {
			ok: false,
			message: "Put the hub token in the token field, not in the URL.",
		};
	}
	if (parsed.protocol === "wss:") {
		return { ok: true, url: parsed.toString() };
	}
	const loopback =
		parsed.hostname === "localhost" ||
		parsed.hostname === "127.0.0.1" ||
		parsed.hostname === "[::1]";
	if (parsed.protocol === "ws:" && loopback) {
		return { ok: true, url: parsed.toString() };
	}
	if (parsed.protocol === "ws:") {
		return {
			ok: false,
			message:
				"Use wss:// for a remote hub. For a computer on your network, use /handoff so the connection is encrypted.",
		};
	}
	return { ok: false, message: "Use a ws:// or wss:// WebSocket URL." };
}
