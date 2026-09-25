import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listCommandsMock, createPluginCommandServiceMock } = vi.hoisted(() => {
	const listCommandsMock = vi.fn(async () => []);
	return {
		listCommandsMock,
		createPluginCommandServiceMock: vi.fn(() => ({
			listCommands: listCommandsMock,
			run: vi.fn(),
			shutdown: vi.fn(),
		})),
	};
});

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		createPluginCommandService: createPluginCommandServiceMock,
	};
});

import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

function createContext(kind: "local" | "ssh" = "local"): SidecarContext {
	return {
		activeEnvironmentId: "env",
		localWorkspaceRoot: "/local/launch-root",
		remoteEnvironments: {
			run: vi.fn(async () => ({ stdout: "", stderr: "" })),
		},
		runtimeBindings: new Map([
			[
				"env",
				{
					kind,
					environmentId: "env",
					workspaceRoot: "/local/launch-root",
				},
			],
		]),
	} as unknown as SidecarContext;
}

describe("plugin command warmup", () => {
	let workspace: string;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "plugin-warmup-"));
		listCommandsMock.mockClear();
		createPluginCommandServiceMock.mockClear();
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	it("warms the plugin sandbox once for the workspace the webview reports", async () => {
		const ctx = createContext();
		await expect(
			handleCommand(ctx, "get_git_branch", { cwd: workspace }),
		).resolves.toMatchObject({ environmentId: "env" });

		// Warmup targets the reported workspace, not the launch root.
		expect(createPluginCommandServiceMock).toHaveBeenCalledTimes(1);
		expect(createPluginCommandServiceMock).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: workspace, workspacePath: workspace }),
		);
		expect(listCommandsMock).toHaveBeenCalledTimes(1);

		// The webview polls the branch every few seconds; do not reload each time.
		await handleCommand(ctx, "get_git_branch", { cwd: workspace });
		expect(listCommandsMock).toHaveBeenCalledTimes(1);
	});

	it("does not spawn a sandbox for remote workspaces", async () => {
		const ctx = createContext("ssh");
		await handleCommand(ctx, "get_git_branch", { cwd: "/srv/code" });
		expect(createPluginCommandServiceMock).not.toHaveBeenCalled();
	});
});
