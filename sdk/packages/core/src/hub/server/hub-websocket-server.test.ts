import { describe, expect, it, vi } from "vitest";
import {
	isLocalHubHostName,
	isLocalHubOrigin,
	readBearerToken,
	wrapWsSocket,
} from "./hub-websocket-server";

describe("wrapWsSocket", () => {
	function createNodeSocket() {
		const listeners = new Map<string, (data?: unknown) => void>();
		return {
			listeners,
			sent: [] as string[],
			send(data: string) {
				this.sent.push(data);
			},
			on(event: string, listener: (data?: unknown) => void) {
				listeners.set(event, listener);
			},
			once(event: string, listener: (data?: unknown) => void) {
				listeners.set(event, listener);
			},
			emit(event: string, data?: unknown) {
				listeners.get(event)?.(data);
			},
		};
	}

	it("decodes binary frames before handing them to the message listener", () => {
		const socket = createNodeSocket();
		const received: string[] = [];
		wrapWsSocket(socket).addEventListener("message", ((event: {
			data: string;
		}) => {
			received.push(event.data);
		}) as never);

		socket.emit("message", Buffer.from('{"kind":"event"}'));
		socket.emit("message", '{"kind":"reply"}');

		expect(received).toEqual(['{"kind":"event"}', '{"kind":"reply"}']);
	});

	it("contains a rejected listener promise instead of leaking an unhandled rejection", async () => {
		const socket = createNodeSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const rejections: unknown[] = [];
		const onRejection = (error: unknown) => rejections.push(error);
		process.on("unhandledRejection", onRejection);

		try {
			wrapWsSocket(socket).addEventListener("message", (() =>
				Promise.reject(new Error("listener boom"))) as never);

			socket.emit("message", "{}");
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(rejections).toEqual([]);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("listener boom"),
			);
		} finally {
			process.off("unhandledRejection", onRejection);
			errorSpy.mockRestore();
		}
	});
});

describe("readBearerToken", () => {
	it("reads a bearer token with case-insensitive scheme", () => {
		expect(readBearerToken("Bearer token")).toBe("token");
		expect(readBearerToken("bearer token")).toBe("token");
	});

	it("reads a bearer token separated by tabs without regex backtracking", () => {
		expect(readBearerToken(`bearer\t\t${"token"}`)).toBe("token");
		expect(readBearerToken(`bearer${"\t".repeat(10_000)}token`)).toBe("token");
	});

	it("rejects missing and malformed bearer tokens", () => {
		expect(readBearerToken(undefined)).toBeNull();
		expect(readBearerToken("Bearer")).toBeNull();
		expect(readBearerToken("BearerToken")).toBeNull();
		expect(readBearerToken("Basic token")).toBeNull();
	});
});

describe("loopback websocket origin auth", () => {
	it("recognizes loopback Hub hosts and browser origins", () => {
		expect(isLocalHubHostName("127.0.0.1")).toBe(true);
		expect(isLocalHubHostName("localhost")).toBe(true);
		expect(isLocalHubHostName("::1")).toBe(true);
		expect(isLocalHubOrigin("http://localhost:3000")).toBe(true);
		expect(isLocalHubOrigin("http://127.0.0.1:3017")).toBe(true);
	});

	it("rejects non-loopback browser origins", () => {
		expect(isLocalHubOrigin("https://example.com")).toBe(false);
		expect(isLocalHubOrigin("http://192.168.1.10:3000")).toBe(false);
		expect(isLocalHubOrigin(undefined)).toBe(false);
	});
});
