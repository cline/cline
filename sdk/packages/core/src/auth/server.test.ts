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
