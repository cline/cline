import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	attachHub: vi.fn(),
	initializePeer: vi.fn(),
	restartHub: vi.fn(),
}));

vi.mock("./hub", () => ({
	attachHub: mocks.attachHub,
	restartHub: mocks.restartHub,
}));

vi.mock("./sessions", () => ({
	initializePeer: mocks.initializePeer,
}));

describe("connectHubFromWebview", () => {
	beforeEach(() => {
		mocks.attachHub.mockReset();
		mocks.initializePeer.mockReset();
		mocks.restartHub.mockReset();
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

describe("restartHubFromWebview", () => {
	beforeEach(() => {
		mocks.restartHub.mockReset();
	});

	it("reports a successful restart", async () => {
		const send = vi.fn();
		const ctx = { send };
		const peer = {};
		const { restartHubFromWebview } = await import("./hub-actions");

		await restartHubFromWebview(ctx as never, peer as never);

		expect(mocks.restartHub).toHaveBeenCalledWith(ctx);
		expect(send).toHaveBeenCalledWith(peer, {
			type: "hub_restart_result",
			ok: true,
		});
	});

	it("reports restart failures", async () => {
		mocks.restartHub.mockRejectedValue(new Error("Unable to stop the hub"));
		const send = vi.fn();
		const ctx = { send };
		const peer = {};
		const { restartHubFromWebview } = await import("./hub-actions");

		await restartHubFromWebview(ctx as never, peer as never);

		expect(send).toHaveBeenCalledWith(peer, {
			type: "hub_restart_result",
			ok: false,
			error: "Unable to stop the hub",
		});
	});
});
