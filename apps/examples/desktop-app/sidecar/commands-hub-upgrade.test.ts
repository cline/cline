import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	LiveSession,
	SidecarContext,
	SidecarWebSocketClient,
} from "./types";

const { checkManagedHubBuildMismatchMock, upgradeManagedHubMock } = vi.hoisted(
	() => ({
		checkManagedHubBuildMismatchMock: vi.fn(),
		upgradeManagedHubMock: vi.fn(),
	}),
);

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		checkManagedHubBuildMismatch: checkManagedHubBuildMismatchMock,
		upgradeManagedHub: upgradeManagedHubMock,
		resolveAgentPluginPathsWithDiagnostics: () => ({
			paths: ["/plugins/next-turn/index.ts"],
			disabledPaths: [],
			discoveryFailures: [],
		}),
	};
});

const missingPluginUi = {
	url: "ws://127.0.0.1:25463/hub",
	reason: "missing_capability" as const,
	hubBuildId: "source-0.0.93",
	expectedBuildId: "source-0.0.93",
	missingCapabilities: ["plugins.ui"],
};

function liveSession(environmentId: string | undefined): LiveSession {
	return {
		environmentId,
		config: {},
		messages: [],
		promptsInQueue: [],
		busy: false,
		startedAt: 0,
		status: "idle",
	};
}

function createContext(): SidecarContext {
	return {
		localWorkspaceRoot: "/workspace",
		wsClients: new Set([{ send: vi.fn() }]),
		liveSessions: new Map([
			["local-chat", liveSession("local")],
			["cloud-chat", liveSession(undefined)],
		]),
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

function mismatchBroadcasts(ctx: SidecarContext): unknown[] {
	const [socket] = ctx.wsClients as Set<{ send: ReturnType<typeof vi.fn> }>;
	return (socket?.send.mock.calls ?? [])
		.map(
			([encoded]) =>
				JSON.parse(String(encoded)) as {
					event: { name: string; payload: unknown };
				},
		)
		.filter((message) => message.event.name === "hub_build_mismatch")
		.map((message) => message.event.payload);
}

beforeEach(() => {
	upgradeManagedHubMock.mockReset();
	checkManagedHubBuildMismatchMock.mockReset();
	checkManagedHubBuildMismatchMock.mockResolvedValue(undefined);
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
			requiredCapabilities: ["plugins.ui"],
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
		expect(ctx.liveSessions.get("local-chat")?.pluginsStale).toBeUndefined();
	});

	it.each([
		"replaced",
		"started",
	])("restarts open local chats on the new hub after it was %s", async (outcome) => {
		upgradeManagedHubMock.mockResolvedValue({
			outcome,
			url: "ws://127.0.0.1:25463/hub",
		});
		const { handleCommand } = await import("./commands");
		const ctx = createContext();

		await handleCommand(
			ctx,
			"hub_upgrade",
			{},
			{ connection: connection(true) },
		);

		expect(ctx.liveSessions.get("local-chat")?.pluginsStale).toBe(true);
		expect(ctx.liveSessions.get("cloud-chat")?.pluginsStale).toBeUndefined();
	});

	it("checks the Hub that came up and clears the notice once it serves plugin UI", async () => {
		upgradeManagedHubMock.mockResolvedValue({
			outcome: "replaced",
			url: "ws://127.0.0.1:25463/hub",
		});
		const { handleCommand } = await import("./commands");
		const ctx = createContext();
		ctx.hubBuildMismatch = missingPluginUi;

		await handleCommand(
			ctx,
			"hub_upgrade",
			{},
			{ connection: connection(true) },
		);

		expect(checkManagedHubBuildMismatchMock).toHaveBeenCalledWith({
			requiredCapabilities: ["plugins.ui"],
		});
		expect(ctx.hubBuildMismatch).toBeNull();
		expect(mismatchBroadcasts(ctx)).toEqual([null]);
	});

	// Another Cline app's hub client respawns its own build as soon as the old
	// Hub stops, and this app then reuses that Hub as the same identity.
	it.each([
		"replaced",
		"started",
	])("keeps the notice when the Hub that came up after it was %s still lacks plugin UI", async (outcome) => {
		upgradeManagedHubMock.mockResolvedValue({
			outcome,
			url: "ws://127.0.0.1:25463/hub",
		});
		const stillMissing = { ...missingPluginUi, activeSessionCount: 1 };
		checkManagedHubBuildMismatchMock.mockResolvedValue(stillMissing);
		const { handleCommand } = await import("./commands");
		const ctx = createContext();
		ctx.hubBuildMismatch = missingPluginUi;

		await expect(
			handleCommand(ctx, "hub_upgrade", {}, { connection: connection(true) }),
		).rejects.toThrow(
			"Another Cline app restarted the Cline Hub with its own version first, so suggestions are still off. Quit the other Cline apps, then restart the Hub again.",
		);
		expect(ctx.hubBuildMismatch).toEqual(stillMissing);
		expect(mismatchBroadcasts(ctx)).toEqual([
			expect.objectContaining(stillMissing),
		]);
		expect(ctx.liveSessions.get("local-chat")?.pluginsStale).toBe(true);
	});
});

describe("hub_session_activity command", () => {
	it("counts the sessions the Hub is serving right now", async () => {
		const { handleCommand } = await import("./commands");
		const ctx = createContext();
		const hubCommand = vi.fn(async () => ({
			ok: true,
			payload: {
				sessions: [
					{ sessionId: "a", participants: [{ clientId: "desktop" }] },
					{ sessionId: "b", participants: [{ clientId: "cli" }] },
					{ sessionId: "c", participants: [] },
				],
			},
		}));
		ctx.runtimeBindings = new Map([
			["local", { hubClient: { command: hubCommand } }],
		]) as never;

		await expect(
			handleCommand(ctx, "hub_session_activity", {}),
		).resolves.toEqual({ activeSessionCount: 2, participantClientCount: 2 });
		expect(hubCommand).toHaveBeenCalledWith("session.list", { limit: 500 });
	});

	it("fails when the Hub cannot list its sessions", async () => {
		const { handleCommand } = await import("./commands");
		const ctx = createContext();
		ctx.runtimeBindings = new Map([
			[
				"local",
				{
					hubClient: {
						command: vi.fn(async () => ({
							ok: false,
							error: { message: "unsupported_command" },
						})),
					},
				},
			],
		]) as never;

		await expect(
			handleCommand(ctx, "hub_session_activity", {}),
		).rejects.toThrow("unsupported_command");
	});
});
