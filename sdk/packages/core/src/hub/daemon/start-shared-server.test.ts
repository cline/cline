import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnsureHubServerOptions } from "./start-shared-server";

const {
	mockEnsureHubWebSocketServer,
	mockResolveHubEndpointOptions,
	mockResolveClineBuildEnv,
	mockResolveDefaultHubOwnerContext,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockStartHubWebSocketServer,
} = vi.hoisted(() => ({
	mockEnsureHubWebSocketServer: vi.fn(async () => ({
		url: "ws://127.0.0.1:25463/hub",
		authToken: "token",
		action: "started",
	})),
	mockResolveHubEndpointOptions: vi.fn(
		(options: { host?: string; port?: number; pathname?: string }) => ({
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 25463,
			pathname: options.pathname ?? "/hub",
		}),
	),
	mockResolveClineBuildEnv: vi.fn(() => "production"),
	mockResolveDefaultHubOwnerContext: vi.fn(() =>
		mockResolveClineBuildEnv() === "production"
			? mockResolveProductionHubOwnerContext()
			: mockResolveSharedHubOwnerContext(),
	),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "shared",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/shared.json",
	})),
	mockStartHubWebSocketServer: vi.fn(),
}));

vi.mock("@cline/shared", () => ({
	resolveClineBuildEnv: mockResolveClineBuildEnv,
}));

vi.mock("../discovery/defaults", () => ({
	resolveHubEndpointOptions: mockResolveHubEndpointOptions,
}));

vi.mock("../discovery/workspace", () => ({
	resolveDefaultHubOwnerContext: mockResolveDefaultHubOwnerContext,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
}));

vi.mock("../server", () => ({
	ensureHubWebSocketServer: mockEnsureHubWebSocketServer,
	startHubWebSocketServer: mockStartHubWebSocketServer,
}));

const originalHubPort = process.env.CLINE_HUB_PORT;
const runtimeHandlers =
	{} as unknown as EnsureHubServerOptions["runtimeHandlers"];

describe("ensureHubServer", () => {
	afterEach(() => {
		mockEnsureHubWebSocketServer.mockClear();
		mockResolveHubEndpointOptions.mockClear();
		mockResolveClineBuildEnv.mockClear();
		mockResolveClineBuildEnv.mockReturnValue("production");
		mockResolveDefaultHubOwnerContext.mockClear();
		mockResolveProductionHubOwnerContext.mockClear();
		mockResolveSharedHubOwnerContext.mockClear();
		mockStartHubWebSocketServer.mockClear();
		if (originalHubPort === undefined) {
			delete process.env.CLINE_HUB_PORT;
		} else {
			process.env.CLINE_HUB_PORT = originalHubPort;
		}
	});

	it("does not allow port fallback by default in production", async () => {
		delete process.env.CLINE_HUB_PORT;
		const { ensureHubServer } = await import("./start-shared-server");

		await ensureHubServer({ runtimeHandlers });

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 25463,
				allowPortFallback: false,
				owner: expect.objectContaining({
					discoveryPath: "/tmp/cline-data/locks/hub/production.json",
				}),
			}),
		);
	});

	it("allows port fallback by default in development when no port is explicit", async () => {
		delete process.env.CLINE_HUB_PORT;
		mockResolveClineBuildEnv.mockReturnValue("development");
		const { ensureHubServer } = await import("./start-shared-server");

		await ensureHubServer({ runtimeHandlers });

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 25463,
				allowPortFallback: true,
				owner: expect.objectContaining({
					discoveryPath: "/tmp/cline-data/locks/hub/owners/shared.json",
				}),
			}),
		);
	});

	it("does not default port fallback when a port option is explicit", async () => {
		delete process.env.CLINE_HUB_PORT;
		const { ensureHubServer } = await import("./start-shared-server");

		await ensureHubServer({ port: 30000, runtimeHandlers });

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 30000,
				allowPortFallback: false,
			}),
		);
	});

	it("does not default port fallback when CLINE_HUB_PORT is explicit", async () => {
		process.env.CLINE_HUB_PORT = "30001";
		const { ensureHubServer } = await import("./start-shared-server");

		await ensureHubServer({ runtimeHandlers });

		expect(mockEnsureHubWebSocketServer).toHaveBeenCalledWith(
			expect.objectContaining({
				allowPortFallback: false,
			}),
		);
	});
});
