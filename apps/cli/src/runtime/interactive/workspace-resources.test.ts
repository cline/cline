import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createUserInstructionConfigService,
	type UserInstructionConfigService,
} from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatCommandHost } from "../../utils/chat-commands";
import { createMutableUserInstructionConfigService } from "../../utils/mutable-user-instruction-service";
import type { WorkspaceChatCommandHostResult } from "../../utils/plugin-chat-commands";
import { createInteractiveWorkspaceResources } from "./workspace-resources";

describe("interactive workspace resources", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function createWorkspace(commandName: string): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "cli-workspace-resources-"));
		tempRoots.push(root);
		const workflows = join(root, "workflows");
		await mkdir(workflows, { recursive: true });
		await writeFile(
			join(workflows, `${commandName}.md`),
			`---\nname: ${commandName}\n---\nRun ${commandName}.`,
		);
		return root;
	}

	function createInstructionService(cwd: string): UserInstructionConfigService {
		return createUserInstructionConfigService({
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [join(cwd, "workflows")] },
		});
	}

	function createPluginResult(
		commandName: string,
		shutdown = vi.fn(async () => {}),
	): WorkspaceChatCommandHostResult {
		return {
			host: createChatCommandHost().register("command", {
				names: [`/${commandName}`],
				run: async (_parsed, context) => {
					await context.reply(commandName);
				},
			}),
			pluginSlashCommands: [{ name: commandName }],
			shutdown,
		};
	}

	it("commits workflow expansion and plugin commands as one workspace snapshot", async () => {
		const workspaceA = await createWorkspace("workflow-a");
		const workspaceB = await createWorkspace("workflow-b");
		const initialService = createInstructionService(workspaceA);
		await initialService.start();
		const mutableService =
			createMutableUserInstructionConfigService(initialService);
		const onCommandsChanged = vi.fn();
		const resources = createInteractiveWorkspaceResources({
			initialLocation: { cwd: workspaceA, workspaceRoot: workspaceA },
			userInstructionService: mutableService,
			createUserInstructionService: ({ cwd }) => createInstructionService(cwd),
			createPluginCommands: async ({ cwd }) =>
				createPluginResult(cwd === workspaceA ? "plugin-a" : "plugin-b"),
			onCommandsChanged,
		});

		await resources.loadPluginSlashCommands();
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-a")).toBe(
			"Run workflow-a.",
		);
		expect(resources.getCommandSnapshot().pluginSlashCommands).toEqual([
			expect.objectContaining({ name: "plugin-a" }),
		]);

		const applySessionChange = vi.fn(async () => {});
		await resources.changeWorkspace(
			{ cwd: workspaceB, workspaceRoot: workspaceB },
			applySessionChange,
		);

		expect(applySessionChange).toHaveBeenCalledOnce();
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-a")).toBe(
			"/workflow-a",
		);
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-b")).toBe(
			"Run workflow-b.",
		);
		expect(onCommandsChanged).toHaveBeenLastCalledWith({
			workflowSlashCommands: expect.arrayContaining([
				expect.objectContaining({ name: "workflow-b" }),
			]),
			pluginSlashCommands: [expect.objectContaining({ name: "plugin-b" })],
		});
		expect(
			onCommandsChanged.mock.calls
				.at(-1)?.[0]
				.workflowSlashCommands.map((command: { name: string }) => command.name),
		).not.toContain("workflow-a");

		await resources.dispose();
		mutableService.stop();
	});

	it("keeps the previous workspace active when the agent session transition fails", async () => {
		const workspaceA = await createWorkspace("workflow-a");
		const workspaceB = await createWorkspace("workflow-b");
		const initialService = createInstructionService(workspaceA);
		await initialService.start();
		const mutableService =
			createMutableUserInstructionConfigService(initialService);
		const nextPluginShutdown = vi.fn(async () => {});
		const resources = createInteractiveWorkspaceResources({
			initialLocation: { cwd: workspaceA, workspaceRoot: workspaceA },
			userInstructionService: mutableService,
			createUserInstructionService: ({ cwd }) => createInstructionService(cwd),
			createPluginCommands: async () =>
				createPluginResult("plugin-b", nextPluginShutdown),
		});

		await expect(
			resources.changeWorkspace(
				{ cwd: workspaceB, workspaceRoot: workspaceB },
				async () => {
					throw new Error("session restart failed");
				},
			),
		).rejects.toThrow("session restart failed");
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-a")).toBe(
			"Run workflow-a.",
		);
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-b")).toBe(
			"/workflow-b",
		);
		expect(nextPluginShutdown).toHaveBeenCalledOnce();

		await resources.dispose();
		mutableService.stop();
	});

	it("rejects incompatible instruction services before changing the agent session", async () => {
		const workspaceA = await createWorkspace("workflow-a");
		const workspaceB = await createWorkspace("workflow-b");
		const initialService = createInstructionService(workspaceA);
		await initialService.start();
		const mutableService =
			createMutableUserInstructionConfigService(initialService);
		const incompatibleService = createInstructionService(workspaceB);
		incompatibleService.createSkillsExecutor = undefined;
		const applySessionChange = vi.fn(async () => {});
		const resources = createInteractiveWorkspaceResources({
			initialLocation: { cwd: workspaceA, workspaceRoot: workspaceA },
			userInstructionService: mutableService,
			createUserInstructionService: () => incompatibleService,
			createPluginCommands: async () => createPluginResult("plugin-b"),
		});

		await expect(
			resources.changeWorkspace(
				{ cwd: workspaceB, workspaceRoot: workspaceB },
				applySessionChange,
			),
		).rejects.toThrow("incompatible skills capability");
		expect(applySessionChange).not.toHaveBeenCalled();
		expect(mutableService.resolveRuntimeSlashCommand("/workflow-a")).toBe(
			"Run workflow-a.",
		);

		await resources.dispose();
		mutableService.stop();
	});

	it("does not let a stale plugin load replace a newer workspace", async () => {
		const workspaceA = await createWorkspace("workflow-a");
		const workspaceB = await createWorkspace("workflow-b");
		const initialService = createInstructionService(workspaceA);
		await initialService.start();
		const mutableService =
			createMutableUserInstructionConfigService(initialService);
		let resolveStaleLoad:
			| ((value: WorkspaceChatCommandHostResult) => void)
			| undefined;
		const staleLoad = new Promise<WorkspaceChatCommandHostResult>((resolve) => {
			resolveStaleLoad = resolve;
		});
		const staleShutdown = vi.fn(async () => {});
		const resources = createInteractiveWorkspaceResources({
			initialLocation: { cwd: workspaceA, workspaceRoot: workspaceA },
			userInstructionService: mutableService,
			createUserInstructionService: ({ cwd }) => createInstructionService(cwd),
			createPluginCommands: ({ cwd }) =>
				cwd === workspaceA
					? staleLoad
					: Promise.resolve(createPluginResult("plugin-b")),
		});

		const loadingA = resources.loadPluginSlashCommands();
		const changing = resources.changeWorkspace(
			{ cwd: workspaceB, workspaceRoot: workspaceB },
			async () => {},
		);
		resolveStaleLoad?.(createPluginResult("plugin-a", staleShutdown));
		await Promise.all([loadingA, changing]);

		expect(resources.getCommandSnapshot().pluginSlashCommands).toEqual([
			expect.objectContaining({ name: "plugin-b" }),
		]);
		expect(staleShutdown).toHaveBeenCalledOnce();

		await resources.dispose();
		mutableService.stop();
	});
});
