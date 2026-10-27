/**
 * Minimal WebSocket client for the desktop backend, used by the extension
 * host itself (not the webview) when a host command needs something only the
 * sidecar knows — e.g. the MCP settings path. Speaks the same
 * `{type:"command"}` / `{type:"response"}` protocol as webview/lib/desktop-client.ts.
 *
 * Node 22+ ships a global WebSocket, so no `ws` dependency is needed.
 */

type SidecarResponse = {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

const REQUEST_TIMEOUT_MS = 30_000;

declare const WebSocket: {
	new (
		url: string,
	): {
		readonly readyState: number;
		onopen: ((event: unknown) => void) | null;
		onerror: ((event: unknown) => void) | null;
		onclose: ((event: unknown) => void) | null;
		onmessage: ((event: { data: unknown }) => void) | null;
		send(data: string): void;
		close(): void;
	};
	readonly OPEN: number;
};

export async function invokeSidecar<T>(
	wsEndpoint: string,
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	// The extension host is originless; the sidecar accepts that but refuses
	// to hand approvals to such clients, which is exactly what we want here.
	const url = new URL(wsEndpoint);
	url.searchParams.delete("approval_token");
	const socket = new WebSocket(url.toString());
	const id = `host_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	return await new Promise<T>((resolve, reject) => {
		const finish = (fn: () => void) => {
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// ignore
			}
			fn();
		};
		const timer = setTimeout(
			() =>
				finish(() =>
					reject(new Error(`sidecar command timed out: ${command}`)),
				),
			REQUEST_TIMEOUT_MS,
		);
		socket.onerror = () =>
			finish(() =>
				reject(new Error(`sidecar connection failed for ${command}`)),
			);
		socket.onopen = () => {
			socket.send(JSON.stringify({ type: "command", id, command, args }));
		};
		socket.onmessage = (event) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(event.data));
			} catch {
				return;
			}
			const message = parsed as Partial<SidecarResponse>;
			if (message.type !== "response" || message.id !== id) return;
			finish(() => {
				if (message.ok) resolve(message.result as T);
				else
					reject(
						new Error(message.error ?? `sidecar command failed: ${command}`),
					);
			});
		};
	});
}
