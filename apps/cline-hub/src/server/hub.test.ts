import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createCline: vi.fn(),
	createUiClient: vi.fn(),
	ensureDetachedHubServer: vi.fn(),
	rememberRecoverableLocalHubUrl: vi.fn((url: string) => url),
	stopLocalHubServerGracefully: vi.fn(),
	rejectAllPendingApprovals: vi.fn(),
	broadcastHubState: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	CORE_BUILD_VERSION: "test",
	ClineCore: { create: mocks.createCline },
	HubUIClient: vi.fn(function HubUIClient(options: unknown) {
		return mocks.createUiClient(options);
	}),
	ensureDetachedHubServer: mocks.ensureDetachedHubServer,
	rememberRecoverableLocalHubUrl: mocks.rememberRecoverableLocalHubUrl,
	stopLocalHubServerGracefully: mocks.stopLocalHubServerGracefully,
	toHubHealthUrl: (url: string) => url,
}));

vi.mock("./agent-events", () => ({
	handleSessionEvent: vi.fn(),
}));

vi.mock("./approvals", () => ({
	rejectAllPendingApprovals: mocks.rejectAllPendingApprovals,
	requestToolApprovalFromWebview: vi.fn(),
}));

vi.mock("./deps", () => ({
	workspaceRoot: "/workspace",
}));

vi.mock("./state-payloads", () => ({
	broadcastHubState: mocks.broadcastHubState,
}));

function createClineClient() {
	return {
		dispose: vi.fn(async () => undefined),
		subscribe: vi.fn(),
	};
}

function createUiClient(options: { connectError?: Error } = {}) {
	return {
		close: vi.fn(),
		connect: options.connectError
			? vi.fn(async () => {
					throw options.connectError;
				})
			: vi.fn(async () => undefined),
		listClients: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		subscribeUI: vi.fn(),
	};
}

describe("hub attachment lifecycle", () => {
	beforeEach(() => {
		mocks.createCline.mockReset();
		mocks.createUiClient.mockReset();
		mocks.ensureDetachedHubServer.mockReset();
		mocks.ensureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "new-token",
		});
		mocks.rememberRecoverableLocalHubUrl.mockClear();
		mocks.stopLocalHubServerGracefully.mockReset();
		mocks.stopLocalHubServerGracefully.mockResolvedValue(true);
		mocks.rejectAllPendingApprovals.mockClear();
		mocks.broadcastHubState.mockClear();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false })),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("keeps the existing attachment when a replacement connection fails", async () => {
		const oldCline = createClineClient();
		const oldUiClient = createUiClient();
		const nextCline = createClineClient();
		const connectError = new Error("connection refused");
		const nextUiClient = createUiClient({ connectError });
		mocks.createCline.mockResolvedValue(nextCline);
		mocks.createUiClient.mockReturnValue(nextUiClient);
		const { HubContext } = await import("./state");
		const ctx = new HubContext();
		ctx.hubUrl = "ws://127.0.0.1:25463/hub";
		ctx.hubAuthToken = "old-token";
		ctx.cline = oldCline as never;
		ctx.uiClient = oldUiClient as never;
		const { attachHub } = await import("./hub");

		await expect(
			attachHub(ctx, {
				hubUrl: "ws://127.0.0.1:25464/hub?authToken=new-token",
			}),
		).rejects.toThrow("connection refused");

		expect(oldUiClient.close).not.toHaveBeenCalled();
		expect(oldCline.dispose).not.toHaveBeenCalled();
		expect(ctx.uiClient).toBe(oldUiClient);
		expect(ctx.cline).toBe(oldCline);
		expect(ctx.hubUrl).toBe("ws://127.0.0.1:25463/hub");
		expect(nextUiClient.close).toHaveBeenCalledOnce();
		expect(nextCline.dispose).toHaveBeenCalledOnce();
	});

	it("preserves the dashboard while replacing and reattaching to the hub", async () => {
		const oldCline = createClineClient();
		const oldUiClient = createUiClient();
		const nextCline = createClineClient();
		const nextUiClient = createUiClient();
		mocks.createCline.mockResolvedValue(nextCline);
		mocks.createUiClient.mockReturnValue(nextUiClient);
		const { HubContext } = await import("./state");
		const ctx = new HubContext();
		ctx.cline = oldCline as never;
		ctx.uiClient = oldUiClient as never;
		const { restartHub } = await import("./hub");

		await restartHub(ctx);

		expect(mocks.stopLocalHubServerGracefully).toHaveBeenCalledWith({
			preserveDashboard: true,
		});
		expect(mocks.ensureDetachedHubServer).toHaveBeenCalledWith("/workspace", {
			preserveDashboard: true,
		});
		expect(nextUiClient.connect).toHaveBeenCalledOnce();
		expect(oldUiClient.close).toHaveBeenCalledOnce();
		expect(oldCline.dispose).toHaveBeenCalledOnce();
		expect(ctx.uiClient).toBe(nextUiClient);
		expect(ctx.cline).toBe(nextCline);
	});

	it("does not claim a restart when the current hub cannot stop", async () => {
		mocks.stopLocalHubServerGracefully.mockResolvedValue(false);
		const oldCline = createClineClient();
		const oldUiClient = createUiClient();
		const { HubContext } = await import("./state");
		const ctx = new HubContext();
		ctx.cline = oldCline as never;
		ctx.uiClient = oldUiClient as never;
		const { restartHub } = await import("./hub");

		await expect(restartHub(ctx)).rejects.toThrow(
			"Unable to stop the current Cline Hub.",
		);

		expect(mocks.ensureDetachedHubServer).not.toHaveBeenCalled();
		expect(oldUiClient.close).not.toHaveBeenCalled();
		expect(oldCline.dispose).not.toHaveBeenCalled();
	});
});
