import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import {
	installMarketplaceEntryForDesktopCommand,
	uninstallLocalPrimitive,
	uninstallMarketplaceEntryForDesktopCommand,
} from "./marketplace";
import type { LiveSession, SidecarContext } from "./types";

vi.mock(import("./marketplace"), async (importOriginal) => ({
	...(await importOriginal()),
	installMarketplaceEntryForDesktopCommand: vi.fn(),
	uninstallMarketplaceEntryForDesktopCommand: vi.fn(),
	uninstallLocalPrimitive: vi.fn(),
}));

const { enabledPluginPaths } = vi.hoisted(() => ({
	enabledPluginPaths: { current: [] as string[] },
}));

// The settings listing a plugin toggle returns reads user config folders, and
// plugin discovery reads the person's Documents folder.
vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		createUserInstructionConfigService: () => ({
			start: async () => undefined,
			stop: () => undefined,
			listRecords: () => [],
			listRuntimeCommands: () => [],
		}),
		listHookConfigFiles: () => [],
		resolveAgentConfigSearchPaths: () => [],
		resolveAgentPluginPathsWithDiagnostics: () => ({
			paths: enabledPluginPaths.current,
			disabledPaths: [],
			discoveryFailures: [],
		}),
	};
});

const installMock = vi.mocked(installMarketplaceEntryForDesktopCommand);
const uninstallMock = vi.mocked(uninstallMarketplaceEntryForDesktopCommand);
const uninstallLocalMock = vi.mocked(uninstallLocalPrimitive);

const ENTRY_PATH = "/plugins/_installed/official/next-turn-0a1b/index.ts";
const EMPTY_SETTINGS = {
	workflows: [],
	rules: [],
	plugins: [],
	skills: [],
	tools: [],
	mcp: [],
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

function createContext() {
	const hubCommand = vi.fn(async (command: string, _payload?: unknown) =>
		command === "settings.toggle"
			? { ok: true, payload: { snapshot: EMPTY_SETTINGS } }
			: {
					ok: false,
					error: { code: "plugin_not_found", message: "not loaded" },
				},
	);
	const socketSend = vi.fn();
	const ctx = {
		localWorkspaceRoot: workspaceRoot,
		wsClients: new Set([{ send: socketSend }]),
		hubBuildMismatch: null,
		liveSessions: new Map([
			["local-chat", liveSession("local")],
			["ssh-chat", liveSession("ssh-devbox")],
			["cloud-chat", liveSession(undefined)],
		]),
		runtimeBindings: new Map([
			["local", { hubClient: { command: hubCommand } }],
		]),
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
	const staleSessionIds = () =>
		[...ctx.liveSessions]
			.filter(([, session]) => session.pluginsStale)
			.map(([sessionId]) => sessionId);
	const mismatchBroadcasts = () =>
		socketSend.mock.calls
			.map(
				([encoded]) =>
					JSON.parse(String(encoded)) as {
						event: { name: string; payload: unknown };
					},
			)
			.filter((message) => message.event.name === "hub_build_mismatch")
			.map((message) => message.event.payload);
	return { ctx, hubCommand, mismatchBroadcasts, staleSessionIds };
}

const missingPluginUi = {
	url: "ws://127.0.0.1:25463/hub",
	reason: "missing_capability" as const,
	hubBuildId: "source-0.0.93",
	expectedBuildId: "source-0.0.93",
	missingCapabilities: ["plugins.ui"],
};

function installedPlugin(details?: Record<string, unknown>) {
	return {
		id: "next-turn",
		type: "plugin" as const,
		status: "installed" as const,
		message: "Installed Next Turn.",
		details,
	};
}

let workspaceRoot: string;
let previousClineDir: string | undefined;

beforeEach(() => {
	workspaceRoot = mkdtempSync(join(tmpdir(), "desktop-commands-plugins-"));
	previousClineDir = process.env.CLINE_DIR;
	process.env.CLINE_DIR = join(workspaceRoot, ".cline");
	installMock.mockReset();
	uninstallMock.mockReset();
	uninstallLocalMock.mockReset();
	enabledPluginPaths.current = [];
});

afterEach(() => {
	if (previousClineDir === undefined) {
		delete process.env.CLINE_DIR;
	} else {
		process.env.CLINE_DIR = previousClineDir;
	}
	rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("plugin set changes", () => {
	it("restarts only open local chats after a plugin install", async () => {
		installMock.mockResolvedValue(installedPlugin());
		const { ctx, staleSessionIds } = createContext();

		await handleCommand(ctx, "install_marketplace_entry", {
			id: "next-turn",
			type: "plugin",
		});

		expect(staleSessionIds()).toEqual(["local-chat"]);
	});

	it("asks the hub to retry each installed entry before the install returns", async () => {
		installMock.mockResolvedValue(
			installedPlugin({ entryPaths: [ENTRY_PATH] }),
		);
		const { ctx, hubCommand } = createContext();

		await handleCommand(ctx, "install_marketplace_entry", {
			id: "next-turn",
			type: "plugin",
		});

		expect(hubCommand).toHaveBeenCalledWith("plugins.reload", {
			plugin: ENTRY_PATH,
		});
	});

	it("still reports the install when the hub cannot reload the plugin", async () => {
		const result = installedPlugin({ entryPaths: [ENTRY_PATH] });
		installMock.mockResolvedValue(result);
		const { ctx, hubCommand, staleSessionIds } = createContext();
		hubCommand.mockRejectedValue(new Error("Hub connection closed"));

		await expect(
			handleCommand(ctx, "install_marketplace_entry", {
				id: "next-turn",
				type: "plugin",
			}),
		).resolves.toEqual(result);
		expect(staleSessionIds()).toEqual(["local-chat"]);
	});

	it("leaves open chats alone after a skill install", async () => {
		installMock.mockResolvedValue({
			id: "example-skill",
			type: "skill",
			status: "installed",
			message: "Installed Example Skill.",
		});
		const { ctx, hubCommand, staleSessionIds } = createContext();

		await handleCommand(ctx, "install_marketplace_entry", {
			id: "example-skill",
			type: "skill",
		});

		expect(staleSessionIds()).toEqual([]);
		expect(hubCommand).not.toHaveBeenCalled();
	});

	// Each restart leaves the replaced runtime resident in the Hub, so only a
	// plugin that needs loading restarts open chats.
	it("leaves open chats running after a marketplace uninstall", async () => {
		uninstallMock.mockResolvedValue({
			...installedPlugin(),
			status: "uninstalled",
		});
		const { ctx, staleSessionIds } = createContext();

		await handleCommand(ctx, "uninstall_marketplace_entry", {
			id: "next-turn",
			type: "plugin",
		});

		expect(staleSessionIds()).toEqual([]);
	});

	it("leaves open chats running after a plugin is removed from settings", async () => {
		uninstallLocalMock.mockResolvedValue({
			...installedPlugin(),
			status: "uninstalled",
		});
		const { ctx, staleSessionIds } = createContext();

		await handleCommand(ctx, "uninstall_local_primitive", {
			id: "next-turn",
			type: "plugin",
		});

		expect(staleSessionIds()).toEqual([]);
	});

	it("leaves open chats running after a plugin is turned off", async () => {
		const { ctx, hubCommand, staleSessionIds } = createContext();

		await handleCommand(ctx, "set_plugin_disabled", {
			path: ENTRY_PATH,
			disabled: true,
		});

		expect(hubCommand).toHaveBeenCalledWith(
			"settings.toggle",
			expect.objectContaining({ type: "plugins", path: ENTRY_PATH }),
		);
		expect(staleSessionIds()).toEqual([]);
	});

	it("restarts open local chats after a plugin is turned on", async () => {
		const { ctx, staleSessionIds } = createContext();

		await handleCommand(ctx, "set_plugin_disabled", {
			path: ENTRY_PATH,
			disabled: false,
		});

		expect(staleSessionIds()).toEqual(["local-chat"]);
	});
});

describe("the Restart Hub notice after plugin changes", () => {
	it("appears once a plugin is installed on a Hub without plugin UI", async () => {
		installMock.mockResolvedValue(installedPlugin());
		const { ctx, mismatchBroadcasts } = createContext();
		ctx.hubBuildMismatch = missingPluginUi;
		enabledPluginPaths.current = [ENTRY_PATH];

		await handleCommand(ctx, "install_marketplace_entry", {
			id: "next-turn",
			type: "plugin",
		});

		expect(mismatchBroadcasts()).toEqual([
			expect.objectContaining({ reason: "missing_capability" }),
		]);
	});

	it("goes away once the last plugin is turned off", async () => {
		const { ctx, mismatchBroadcasts } = createContext();
		ctx.hubBuildMismatch = missingPluginUi;

		await handleCommand(ctx, "set_plugin_disabled", {
			path: ENTRY_PATH,
			disabled: true,
		});

		expect(mismatchBroadcasts()).toEqual([null]);
		expect(ctx.hubBuildMismatch).toEqual(missingPluginUi);
	});

	it("leaves the other Hub prompts alone", async () => {
		installMock.mockResolvedValue(installedPlugin());
		const { ctx, mismatchBroadcasts } = createContext();
		ctx.hubBuildMismatch = { ...missingPluginUi, reason: "build_mismatch" };

		await handleCommand(ctx, "install_marketplace_entry", {
			id: "next-turn",
			type: "plugin",
		});

		expect(mismatchBroadcasts()).toEqual([]);
	});
});
