import { NodeHubClient } from "@cline/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSharedHubClient } from "./context";
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

vi.mock("./context", async () => {
	const actual = await vi.importActual<typeof import("./context")>("./context");
	return { ...actual, ensureSharedHubClient: vi.fn() };
});

function createContext(): SidecarContext {
	return {
		localWorkspaceRoot: "/workspace",
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

describe("Factory Hub command routing", () => {
	it.each([
		"task.factory.answer",
		"task.factory.audit",
		"task.factory.audit.resolve",
		"task.factory.stamp",
		"task.factory.priority",
	])("routes trusted %s and rejects untrusted requests before dispatch", async (name) => {
		const { handleCommand } = await import("./commands");
		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const command = vi.spyOn(client, "command").mockResolvedValue({
			version: "v1",
			ok: true,
			payload: { task: { taskId: "feature" } },
		});
		vi.mocked(ensureSharedHubClient).mockResolvedValue(client);
		const ctx = createContext();
		const args = {
			taskId: "feature",
			expectedHead: "head",
			questionId: "question",
			answer: "yes",
			finding: "",
		};
		await expect(
			handleCommand(ctx, name, args, { connection: connection(false) }),
		).rejects.toThrow("trusted desktop connection");
		expect(command).not.toHaveBeenCalled();
		await expect(
			handleCommand(ctx, name, args, { connection: connection(true) }),
		).resolves.toEqual({ task: { taskId: "feature" } });
		expect(command).toHaveBeenCalledWith(name, args);
	});
});

describe("Factory settings command routing", () => {
	it.each([
		["factory_get_guidance", "task.factory.guidance.get", {}],
		[
			"factory_set_guidance",
			"task.factory.guidance.set",
			{
				role: "builder",
				scope: "user",
				expectedHash: "0".repeat(16),
				content: "## A\nB\n",
			},
		],
		[
			"factory_set_verification",
			"task.factory.verification.set",
			{ workspaceRoot: "/repo", decision: "remove" },
		],
		[
			"factory_clean_storage",
			"task.factory.storage.clean",
			{ what: "finished_worktrees" },
		],
		[
			"factory_reset",
			"task.factory.reset",
			{ what: "stage_trust", dryRun: true },
		],
	])("routes trusted %s to %s and rejects untrusted requests before dispatch", async (name, hubCommand, args) => {
		const { handleCommand } = await import("./commands");
		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const command = vi.spyOn(client, "command").mockResolvedValue({
			version: "v1",
			ok: false,
			error: { code: "unsupported_command", message: "old" },
		});
		vi.mocked(ensureSharedHubClient).mockResolvedValue(client);
		const ctx = createContext();
		await expect(
			handleCommand(ctx, name, args, { connection: connection(false) }),
		).rejects.toThrow("trusted desktop connection");
		expect(command).not.toHaveBeenCalled();
		await expect(
			handleCommand(ctx, name, args, { connection: connection(true) }),
		).resolves.toEqual({ supported: false });
		expect(command).toHaveBeenCalledWith(hubCommand, args);
	});

	it.each([
		["factory_delete_preset", { name: "Mine" }],
		["factory_rename_preset", { name: "Mine", newName: "Ours" }],
		["factory_get_connections", {}],
	])("rejects untrusted %s", async (name, args) => {
		const { handleCommand } = await import("./commands");
		await expect(
			handleCommand(createContext(), name, args, {
				connection: connection(false),
			}),
		).rejects.toThrow("trusted desktop connection");
	});
});
