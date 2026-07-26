export interface OAuthCallbackPayload {
	url: URL;
	code?: string;
	state?: string;
	error?: string;
}

export interface OAuthServerListeningInfo {
	host: string;
	port: number;
	callbackUrl: string;
}

export interface OAuthServerCloseInfo {
	host: string;
	port: number;
}

export interface LocalOAuthServer {
	callbackUrl: string;
	waitForCallback: () => Promise<OAuthCallbackPayload | null>;
	cancelWait: () => void;
	close: () => void;
}

export interface LocalOAuthServerOptions {
	host?: string;
	ports: number[];
	callbackPath: string;
	timeoutMs?: number;
	expectedState?: string;
	successHtml?: string;
	onListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
	onClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
}

export async function startLocalOAuthServer(
	options: LocalOAuthServerOptions,
): Promise<LocalOAuthServer> {
	const http = await import("node:http");
	const host = options.host ?? "127.0.0.1";
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
	let resolveCallback!: (value: OAuthCallbackPayload | null) => void;
	const callback = new Promise<OAuthCallbackPayload | null>((resolve) => {
		resolveCallback = resolve;
	});
	let settled = false;
	let server: import("node:http").Server | undefined;
	let boundPort: number | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const settle = (value: OAuthCallbackPayload | null) => {
		if (settled) return;
		settled = true;
		resolveCallback(value);
	};
	const close = () => {
		if (timeout) clearTimeout(timeout);
		timeout = undefined;
		server?.close();
		server?.closeAllConnections?.();
		server = undefined;
		if (boundPort !== undefined) {
			void Promise.resolve(options.onClose?.({ host, port: boundPort })).catch(
				() => {},
			);
			boundPort = undefined;
		}
	};

	for (const port of options.ports) {
		const candidate = http.createServer((request, response) => {
			const url = new URL(request.url ?? "", `http://${host}:${port}`);
			if (url.pathname !== options.callbackPath) {
				response.writeHead(404).end("Not found");
				return;
			}
			const payload: OAuthCallbackPayload = {
				url,
				code: url.searchParams.get("code") ?? undefined,
				state: url.searchParams.get("state") ?? undefined,
				error: url.searchParams.get("error") ?? undefined,
			};
			if (payload.error || !payload.code) {
				response.writeHead(400).end("MCP authorization failed");
				close();
				settle(payload);
				return;
			}
			if (options.expectedState && payload.state !== options.expectedState) {
				response.writeHead(400).end("State mismatch");
				return;
			}
			response
				.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
				.end(
					options.successHtml ??
						"<!doctype html><title>Authorization complete</title><p>You may close this window.</p>",
				);
			close();
			settle(payload);
		});
		const result = await new Promise<"bound" | "in-use">((resolve, reject) => {
			candidate.once("error", (error: NodeJS.ErrnoException) => {
				error.code === "EADDRINUSE" ? resolve("in-use") : reject(error);
			});
			candidate.listen(port, host, () => resolve("bound"));
		});
		if (result === "in-use") continue;

		server = candidate;
		boundPort = port;
		const callbackUrl = `http://${host}:${port}${options.callbackPath}`;
		await Promise.resolve(options.onListening?.({ host, port, callbackUrl })).catch(
			() => {},
		);
		return {
			callbackUrl,
			waitForCallback: async () => {
				timeout = setTimeout(() => {
					close();
					settle(null);
				}, timeoutMs);
				return callback;
			},
			cancelWait: () => {
				close();
				settle(null);
			},
			close: () => {
				close();
				settle(null);
			},
		};
	}

	return {
		callbackUrl: "",
		waitForCallback: async () => null,
		cancelWait: () => {},
		close: () => {},
	};
}
