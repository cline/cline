import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startLocalOAuthServer } from "./server";

const socketBindingSupported = await (async () => {
	try {
		const srv = net.createServer();
		await new Promise<void>((resolve, reject) => {
			srv.listen(0, "127.0.0.1", () => resolve());
			srv.once("error", reject);
		});
		await new Promise<void>((resolve, reject) =>
			srv.close((err) => (err ? reject(err) : resolve())),
		);
		return true;
	} catch {
		return false;
	}
})();
const socketIt = socketBindingSupported ? it : it.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bind to port 0 to let the OS pick a free port, then release it. */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address() as net.AddressInfo;
			srv.close(() => resolve(addr.port));
		});
		srv.on("error", reject);
	});
}

/** Occupy a port so the OAuth server cannot bind to it. */
function occupyPort(port: number): Promise<http.Server> {
	return new Promise((resolve, reject) => {
		const srv = http.createServer();
		srv.listen(port, "127.0.0.1", () => resolve(srv));
		srv.on("error", reject);
	});
}

/** Close an http.Server, resolving when the socket is gone. */
function closeServer(srv: http.Server): Promise<void> {
	return new Promise((resolve, reject) =>
		srv.close((err) => (err ? reject(err) : resolve())),
	);
}

/** Make a GET request and return status + body. */
function get(url: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		http
			.get(url, (res) => {
				let body = "";
				res.on("data", (chunk: Buffer) => {
					body += chunk.toString();
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			})
			.on("error", reject);
	});
}

/** Flush microtasks + a short macro-task delay for fire-and-forget promises. */
function flushAsync(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

// ---------------------------------------------------------------------------
// onListening
// ---------------------------------------------------------------------------

describe("auth/server startLocalOAuthServer — onListening", () => {
	socketIt(
		"is called with host, port, and callbackUrl when the server binds",
		async () => {
			const port = await getFreePort();
			const onListening = vi.fn();

			const server = await startLocalOAuthServer({
				ports: [port],
				callbackPath: "/callback",
				onListening,
			});

			expect(onListening).toHaveBeenCalledOnce();
			expect(onListening).toHaveBeenCalledWith({
				host: "127.0.0.1",
				port,
				callbackUrl: `http://127.0.0.1:${port}/callback`,
			});

			server.close();
		},
	);

	socketIt("is not called when no port can be bound", async () => {
		const port = await getFreePort();
		const blocker = await occupyPort(port);
		const onListening = vi.fn();

		await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onListening,
		});

		expect(onListening).not.toHaveBeenCalled();

		await closeServer(blocker);
	});

	socketIt(
		"fires for the first available port and skips occupied ones",
		async () => {
			const [port1, port2] = await Promise.all([getFreePort(), getFreePort()]);
			const blocker = await occupyPort(port1);
			const onListening = vi.fn();

			const server = await startLocalOAuthServer({
				ports: [port1, port2],
				callbackPath: "/cb",
				onListening,
			});

			expect(onListening).toHaveBeenCalledOnce();
			expect(onListening).toHaveBeenCalledWith(
				expect.objectContaining({ port: port2 }),
			);

			server.close();
			await closeServer(blocker);
		},
	);

	socketIt("swallows errors thrown by the onListening callback", async () => {
		const port = await getFreePort();
		const onListening = vi
			.fn()
			.mockReturnValue(Promise.reject(new Error("listening boom")));

		const server = await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onListening,
		});

		await flushAsync();
		expect(onListening).toHaveBeenCalledOnce();

		server.close();
	});
});

// ---------------------------------------------------------------------------
// onClose
// ---------------------------------------------------------------------------

describe("auth/server startLocalOAuthServer — onClose", () => {
	socketIt("is called with host and port when close() is invoked", async () => {
		const port = await getFreePort();
		const onClose = vi.fn();

		const server = await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onClose,
		});

		server.close();

		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledWith({ host: "127.0.0.1", port });
	});

	socketIt(
		"is called with host and port when cancelWait() is invoked",
		async () => {
			const port = await getFreePort();
			const onClose = vi.fn();

			const server = await startLocalOAuthServer({
				ports: [port],
				callbackPath: "/callback",
				onClose,
			});

			server.cancelWait();

			expect(onClose).toHaveBeenCalledOnce();
			expect(onClose).toHaveBeenCalledWith({ host: "127.0.0.1", port });
		},
	);

	socketIt("is called after a successful OAuth callback request", async () => {
		const port = await getFreePort();
		const onClose = vi.fn();

		const server = await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onClose,
		});

		const waitPromise = server.waitForCallback();
		const { status } = await get(
			`http://127.0.0.1:${port}/callback?code=tok123`,
		);
		expect(status).toBe(200);

		await waitPromise;

		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledWith({ host: "127.0.0.1", port });
	});

	socketIt("is not called when no port was bound", async () => {
		const port = await getFreePort();
		const blocker = await occupyPort(port);
		const onClose = vi.fn();

		const server = await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onClose,
		});

		server.close();
		expect(onClose).not.toHaveBeenCalled();

		await closeServer(blocker);
	});

	socketIt("swallows errors thrown by the onClose callback", async () => {
		const port = await getFreePort();
		const onClose = vi
			.fn()
			.mockReturnValue(Promise.reject(new Error("teardown failed")));

		const server = await startLocalOAuthServer({
			ports: [port],
			callbackPath: "/callback",
			onClose,
		});

		server.close();
		await flushAsync();

		expect(onClose).toHaveBeenCalledOnce();
	});
});

// ---------------------------------------------------------------------------
// Deny -> re-bind same port -> approve (regression)
// ---------------------------------------------------------------------------

describe("auth/server startLocalOAuthServer — sequential flows on a fixed port", () => {
	// Regression: deny an OAuth flow, then immediately start a second flow on the
	// SAME fixed callback port and approve it. The browser uses keep-alive, so
	// the first flow's response can leave a lingering socket that keeps the
	// listening port alive after close(). If close() doesn't drop those sockets,
	// the second server's bind appears to succeed but its callback is delivered
	// to the first (already-settled) server, so waitForCallback() never resolves.
	// This reproduced the "deny then approve never saves a token" bug.
	socketIt("does not serve requests over a pooled keep-alive socket after close()", async () => {
		const port = await getFreePort()

		// A keep-alive agent models the browser / global-fetch connection pool,
		// which keeps a socket to the fixed callback port alive across requests.
		const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
		const getOverAgent = (path: string) =>
			new Promise<{ status: number } | { error: string }>((resolve) => {
				const req = http.get({ host: "127.0.0.1", port, path, agent }, (res) => {
					res.on("data", () => {})
					res.on("end", () => resolve({ status: res.statusCode ?? 0 }))
				})
				req.on("error", (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message }))
			})

		// First flow: deny. The 400 response leaves a pooled keep-alive socket
		// attached to THIS server.
		const first = await startLocalOAuthServer({ ports: [port], callbackPath: "/callback" })
		const firstWait = first.waitForCallback()
		expect(await getOverAgent("/callback?error=access_denied")).toMatchObject({ status: 400 })
		expect((await firstWait)?.error).toBe("access_denied")
		first.close()

		// A second request over the SAME agent must NOT be served by the (now
		// closed, already-settled) first server. Without close() dropping the
		// pooled socket, the request is delivered over it and gets a real
		// response — which is exactly how a re-tried OAuth flow's callback was
		// swallowed by the stale server (deny -> approve saved no token). With
		// the fix, the socket is destroyed, so the reused connection errors
		// instead of reaching the dead server.
		const reused = await getOverAgent("/callback?code=abc123&state=xyz")
		expect(reused).not.toHaveProperty("status")
		expect(reused).toHaveProperty("error")

		// And a brand-new server can bind the same port and serve normally.
		const second = await startLocalOAuthServer({ ports: [port], callbackPath: "/callback" })
		const secondWait = second.waitForCallback()
		expect(await get(`http://127.0.0.1:${port}/callback?code=abc123&state=xyz`)).toMatchObject({ status: 200 })
		const secondPayload = await Promise.race([
			secondWait,
			new Promise<never>((_, rej) => setTimeout(() => rej(new Error("flow 2 callback hung")), 3000)),
		])
		expect(secondPayload?.code).toBe("abc123")

		second.close()
		agent.destroy()
	})
})

// ---------------------------------------------------------------------------
// onListening + onClose ordering
// ---------------------------------------------------------------------------

describe("auth/server startLocalOAuthServer — onListening + onClose together", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	socketIt(
		"fires onListening on bind then onClose after a successful callback",
		async () => {
			const port = await getFreePort();
			const order: string[] = [];

			const server = await startLocalOAuthServer({
				ports: [port],
				callbackPath: "/cb",
				onListening: vi.fn(() => {
					order.push("listening");
				}),
				onClose: vi.fn(() => {
					order.push("close");
				}),
			});

			expect(order).toEqual(["listening"]);

			const waitPromise = server.waitForCallback();
			await get(`http://127.0.0.1:${port}/cb?code=mycode`);
			const payload = await waitPromise;

			expect(payload?.code).toBe("mycode");
			expect(order).toEqual(["listening", "close"]);
		},
	);

	socketIt(
		"fires onListening on bind then onClose after cancelWait()",
		async () => {
			const port = await getFreePort();
			const order: string[] = [];

			const server = await startLocalOAuthServer({
				ports: [port],
				callbackPath: "/cb",
				onListening: vi.fn(() => {
					order.push("listening");
				}),
				onClose: vi.fn(() => {
					order.push("close");
				}),
			});

			expect(order).toEqual(["listening"]);

			server.cancelWait();
			expect(order).toEqual(["listening", "close"]);
		},
	);
});
