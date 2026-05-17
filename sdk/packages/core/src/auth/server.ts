export interface OAuthCallbackPayload {
	url: URL;
	code?: string;
	state?: string;
	provider?: string;
	error?: string;
}

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
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

export interface LocalOAuthServerOptions {
	host?: string;
	ports: number[];
	callbackPath: string;
	timeoutMs?: number;
	expectedState?: string;
	successHtml?: string;
	/**
	 * Called when the local redirect server successfully binds to a port and is
	 * ready to receive the OAuth callback. Hosts can use this to display a
	 * "waiting for callback" status indicator or — in remote-development
	 * environments like JetBrains Gateway — to forward the port from the remote
	 * machine to the local machine where the user's browser is running.
	 *
	 * May be async; `startLocalOAuthServer` will **await** this callback before
	 * returning so that any setup it performs (e.g. port-forwarding) is
	 * guaranteed to complete before the caller opens the auth URL. Errors
	 * thrown by this callback are swallowed — they do not prevent the OAuth
	 * flow from proceeding.
	 */
	onListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
	/**
	 * Called when the local redirect server closes, either because the OAuth
	 * callback was received, the flow was cancelled, or the timeout elapsed.
	 * Hosts should use this to tear down any port-forward set up in
	 * `onListening` and clear any "waiting for callback" status UI.
	 *
	 * May be async; fired after the underlying server socket is closed.
	 */
	onClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
}

export interface LocalOAuthServer {
	callbackUrl: string;
	waitForCallback: () => Promise<OAuthCallbackPayload | null>;
	cancelWait: () => void;
	close: () => void;
}

export async function startLocalOAuthServer(
	options: LocalOAuthServerOptions,
): Promise<LocalOAuthServer> {
	const http = await import("node:http");

	const host = options.host ?? "127.0.0.1";
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
	const successHtml = options.successHtml ?? HTML_CONTENT;

	const deferred = createDeferred<OAuthCallbackPayload | null>();
	let settled = false;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	let activeServer: import("node:http").Server | null = null;
	let boundPort: number | null = null;

	const settle = (value: OAuthCallbackPayload | null) => {
		if (settled) return;
		settled = true;
		deferred.resolve(value);
	};

	const close = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		const closingPort = boundPort;
		boundPort = null;
		if (activeServer) {
			activeServer.close();
			activeServer = null;
		}
		if (closingPort !== null && options.onClose) {
			void Promise.resolve(options.onClose({ host, port: closingPort })).catch(
				() => {},
			);
		}
	};

	const waitForCallback = async () => {
		timeout = setTimeout(() => {
			close();
			settle(null);
		}, timeoutMs);
		return deferred.promise;
	};

	for (const port of options.ports) {
		const server = http.createServer((req, res) => {
			try {
				const requestUrl = new URL(req.url || "", `http://${host}:${port}`);
				if (requestUrl.pathname !== options.callbackPath) {
					res.statusCode = 404;
					res.end("Not found");
					return;
				}

				const payload: OAuthCallbackPayload = {
					url: requestUrl,
					code: requestUrl.searchParams.get("code") ?? undefined,
					state: requestUrl.searchParams.get("state") ?? undefined,
					provider: requestUrl.searchParams.get("provider") ?? undefined,
					error: requestUrl.searchParams.get("error") ?? undefined,
				};

				if (payload.error) {
					res.statusCode = 400;
					res.end(`Authentication failed: ${payload.error}`);
					close();
					settle(payload);
					return;
				}

				if (!payload.code) {
					res.statusCode = 400;
					res.end("Missing authorization code");
					return;
				}

				if (options.expectedState && payload.state !== options.expectedState) {
					res.statusCode = 400;
					res.end("State mismatch");
					return;
				}

				res.statusCode = 200;
				res.setHeader("Content-Type", "text/html; charset=utf-8");
				res.end(successHtml);
				close();
				settle(payload);
			} catch {
				res.statusCode = 500;
				res.end("Internal error");
			}
		});

		const bindResult = await new Promise<{
			bound: boolean;
			error?: NodeJS.ErrnoException;
		}>((resolve) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.off("error", onError);
				resolve({ bound: false, error });
			};

			server.once("error", onError);
			server.listen(port, host, () => {
				server.off("error", onError);
				activeServer = server;
				resolve({ bound: true });
			});
		});

		if (bindResult.error) {
			if (bindResult.error.code === "EADDRINUSE") {
				continue;
			}
			close();
			throw bindResult.error;
		}

		if (bindResult.bound) {
			boundPort = port;
			const callbackUrl = `http://${host}:${port}${options.callbackPath}`;
			if (options.onListening) {
				await Promise.resolve(
					options.onListening({ host, port, callbackUrl }),
				).catch(() => {});
			}
			return {
				callbackUrl,
				waitForCallback,
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
	}

	return {
		callbackUrl: "",
		waitForCallback: async () => null,
		cancelWait: () => {},
		close: () => {},
	};
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authentication Successful</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
  }
  .container { text-align: center; padding: 48px; max-width: 420px; }
  .icon {
    width: 72px; height: 72px; margin: 0 auto 24px;
    background: linear-gradient(135deg, #10a37f 0%, #1a7f64 100%);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }
  .icon svg { width: 36px; height: 36px; stroke: #fff; stroke-width: 3; fill: none; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
  p { font-size: 15px; color: rgba(255,255,255,0.7); line-height: 1.5; }
  .closing { margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.5); }
</style>
</head>
<body>
<div class="container">
  <div class="icon">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </div>
  <h1>Authentication Successful</h1>
  <p>You're now signed in. You can close this window.</p>
  <p class="closing">This window will close automatically...</p>
</div>
<script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
