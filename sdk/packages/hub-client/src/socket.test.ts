import { afterEach, describe, expect, it } from "vitest";
import {
	createHubSocket,
	HUB_AUTH_PROTOCOL_PREFIX,
	type HubSocketRequestOptions,
	resolveHubSocketProtocols,
	resolveHubSocketRequestOptions,
	type WebSocketLike,
} from "./socket";

type CtorCall = {
	url: string;
	protocols: string | string[] | undefined;
	options: HubSocketRequestOptions | undefined;
	argCount: number;
};

const calls: CtorCall[] = [];

class RecordingWebSocket implements WebSocketLike {
	readyState = 0;

	constructor(
		url: string,
		protocols?: string | string[],
		options?: HubSocketRequestOptions,
	) {
		calls.push({
			url,
			protocols,
			options,
			argCount: arguments.length,
		});
	}

	send(): void {}
	close(): void {}
	addEventListener(): void {}
}

afterEach(() => {
	calls.length = 0;
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe("resolveHubSocketProtocols", () => {
	it("builds the exact local-hub subprotocol string", () => {
		expect(
			resolveHubSocketProtocols({
				url: "ws://127.0.0.1:1/hub",
				authMode: "hub-subprotocol",
				credential: "s3cret",
			}),
		).toEqual(["cline-hub-auth.s3cret"]);
		expect(HUB_AUTH_PROTOCOL_PREFIX).toBe("cline-hub-auth.");
	});

	it("omits protocols when the credential is missing or blank", () => {
		expect(
			resolveHubSocketProtocols({
				url: "ws://127.0.0.1:1/hub",
				authMode: "hub-subprotocol",
			}),
		).toBeUndefined();
		expect(
			resolveHubSocketProtocols({
				url: "ws://127.0.0.1:1/hub",
				authMode: "hub-subprotocol",
				credential: "   ",
			}),
		).toBeUndefined();
	});

	it("never emits a subprotocol in bearer-header or none mode", () => {
		expect(
			resolveHubSocketProtocols({
				url: "ws://h/hub",
				authMode: "bearer-header",
				credential: "s3cret",
			}),
		).toBeUndefined();
		expect(
			resolveHubSocketProtocols({
				url: "ws://h/hub",
				authMode: "none",
				credential: "s3cret",
			}),
		).toBeUndefined();
	});
});

describe("resolveHubSocketRequestOptions", () => {
	it("sets an Authorization bearer header in bearer-header mode", () => {
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "bearer-header",
				credential: "s3cret",
			}),
		).toEqual({ headers: { Authorization: "Bearer s3cret" } });
	});

	it("never emits an Authorization header in hub-subprotocol or none mode", () => {
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "hub-subprotocol",
				credential: "s3cret",
			}),
		).toBeUndefined();
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "none",
				credential: "s3cret",
			}),
		).toBeUndefined();
	});

	it("passes through caller headers without adding credentials", () => {
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "none",
				credential: "s3cret",
				headers: { "x-client": "mobile" },
			}),
		).toEqual({ headers: { "x-client": "mobile" } });
	});

	it("merges caller headers with the bearer header", () => {
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "bearer-header",
				credential: "s3cret",
				headers: { "x-client": "mobile" },
			}),
		).toEqual({
			headers: { "x-client": "mobile", Authorization: "Bearer s3cret" },
		});
	});

	it("omits bearer header when the credential is blank", () => {
		expect(
			resolveHubSocketRequestOptions({
				url: "ws://h/hub",
				authMode: "bearer-header",
				credential: "  ",
			}),
		).toBeUndefined();
	});
});

describe("createHubSocket", () => {
	it("constructs a subprotocol-authenticated socket with two ctor args", () => {
		createHubSocket({
			url: "ws://127.0.0.1:1/hub",
			authMode: "hub-subprotocol",
			credential: "tok",
			WebSocketImpl: RecordingWebSocket,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			url: "ws://127.0.0.1:1/hub",
			protocols: ["cline-hub-auth.tok"],
			options: undefined,
			argCount: 2,
		});
	});

	it("constructs a bearer socket with undefined protocols and header options", () => {
		createHubSocket({
			url: "wss://hub.example/hub",
			authMode: "bearer-header",
			credential: "tok",
			WebSocketImpl: RecordingWebSocket,
		});
		expect(calls[0]).toMatchObject({
			protocols: undefined,
			options: { headers: { Authorization: "Bearer tok" } },
			argCount: 3,
		});
	});

	it("constructs an unauthenticated socket with a single ctor arg", () => {
		createHubSocket({
			url: "ws://127.0.0.1:1/hub",
			authMode: "none",
			WebSocketImpl: RecordingWebSocket,
		});
		expect(calls[0]).toMatchObject({ protocols: undefined, argCount: 1 });
	});

	it("falls back to globalThis.WebSocket", () => {
		(globalThis as { WebSocket?: unknown }).WebSocket = RecordingWebSocket;
		createHubSocket({ url: "ws://127.0.0.1:1/hub", authMode: "none" });
		expect(calls).toHaveLength(1);
	});

	it("throws the runtime-guidance error when no WebSocket exists", () => {
		expect(() =>
			createHubSocket({ url: "ws://127.0.0.1:1/hub", authMode: "none" }),
		).toThrow(
			"Global WebSocket is not available in this runtime. Node 22+ is required for hub mode.",
		);
	});
});
