import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

const upgradeManagedHubMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		upgradeManagedHub: upgradeManagedHubMock,
	};
});

function createContext(): SidecarContext {
	return {
		workspaceRoot: "/workspace",
		wsClients: new Set(),
		hubBuildMismatch: {
			url: "ws://127.0.0.1:25463/hub",
			reason: "outdated_hub",
			expectedBuildId: "current-build",
		},
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
}

function connection(canApproveTools: boolean): SidecarWebSocketClient {
	return { data: { canApproveTools } } as unknown as SidecarWebSocketClient;
}

beforeEach(() => {
	upgradeManagedHubMock.mockReset();
});

describe("hub_upgrade command", () => {
	it("rejects connections without the approval token, before touching the hub", async () => {
		const { handleCommand } = await import("./commands");
		const ctx = createContext();

		await expect(
			handleCommand(ctx, "hub_upgrade", {}, { connection: connection(false) }),
		).rejects.toThrow(/trusted desktop connection/);
		await expect(handleCommand(ctx, "hub_upgrade", {}, {})).rejects.toThrow(
			/trusted desktop connection/,
		);
		expect(upgradeManagedHubMock).not.toHaveBeenCalled();
		// The pending mismatch must survive a refused request.
		expect(ctx.hubBuildMismatch).not.toBeNull();
	});

	it("forces the upgrade for the trusted webview connection and clears the mismatch", async () => {
		upgradeManagedHubMock.mockResolvedValue({
			outcome: "replaced",
			url: "ws://127.0.0.1:25463/hub",
			authToken: "new-token",
			activeSessionCount: 2,
		});
		const { handleCommand } = await import("./commands");
		const ctx = createContext();

		const result = await handleCommand(
			ctx,
			"hub_upgrade",
			{},
			{ connection: connection(true) },
		);

		expect(upgradeManagedHubMock).toHaveBeenCalledWith({
			workspaceRoot: "/workspace",
			force: true,
			reason: "Cline Desktop hub update",
		});
		expect(result).toEqual({
			outcome: "replaced",
			url: "ws://127.0.0.1:25463/hub",
			interruptedSessionCount: 2,
		});
		expect(ctx.hubBuildMismatch).toBeNull();
	});

	it("surfaces a newer running hub as an error instead of replacing it", async () => {
		upgradeManagedHubMock.mockResolvedValue({
			outcome: "hub_not_older",
			url: "ws://127.0.0.1:25463/hub",
		});
		const { handleCommand } = await import("./commands");
		const ctx = createContext();

		await expect(
			handleCommand(ctx, "hub_upgrade", {}, { connection: connection(true) }),
		).rejects.toThrow(/newer than this app/);
		expect(ctx.hubBuildMismatch).not.toBeNull();
	});
});
