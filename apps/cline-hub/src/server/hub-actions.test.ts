import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	attachHub: vi.fn(),
	initializePeer: vi.fn(),
}));

vi.mock("./hub", () => ({
	attachHub: mocks.attachHub,
}));

vi.mock("./sessions", () => ({
	initializePeer: mocks.initializePeer,
}));

describe("connectHubFromWebview", () => {
	beforeEach(() => {
		mocks.attachHub.mockReset();
		mocks.initializePeer.mockReset();
	});

	it("reports the attached hub after initialization succeeds", async () => {
		const send = vi.fn();
		const ctx = {
			hubUrl: "ws://127.0.0.1:25464/hub",
			send,
		};
		const peer = {};
		const syncClientsAndSessions = vi.fn(async () => undefined);
		const { connectHubFromWebview } = await import("./hub-actions");

		await connectHubFromWebview(
			ctx as never,
			peer as never,
			{
				type: "connect_hub",
				hubUrl: "ws://127.0.0.1:25464/hub?authToken=custom-token",
			},
			syncClientsAndSessions,
		);

		expect(mocks.attachHub).toHaveBeenCalledWith(ctx, {
			hubUrl: "ws://127.0.0.1:25464/hub?authToken=custom-token",
			authToken: undefined,
		});
		expect(mocks.initializePeer).toHaveBeenCalledWith(
			ctx,
			peer,
			syncClientsAndSessions,
		);
		expect(send).toHaveBeenCalledWith(peer, {
			type: "hub_connection_result",
			ok: true,
			hubUrl: "ws://127.0.0.1:25464/hub",
		});
	});

	it("reports connection failures without reinitializing the peer", async () => {
		mocks.attachHub.mockRejectedValue(new Error("connection refused"));
		const send = vi.fn();
		const ctx = { send };
		const peer = {};
		const { connectHubFromWebview } = await import("./hub-actions");

		await connectHubFromWebview(
			ctx as never,
			peer as never,
			{
				type: "connect_hub",
				hubUrl: "ws://127.0.0.1:25464/hub",
				authToken: "custom-token",
			},
			vi.fn(),
		);

		expect(mocks.initializePeer).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith(peer, {
			type: "hub_connection_result",
			ok: false,
			error: "connection refused",
		});
	});
});
