import type { BasicLogger, UserInstructionConfigService } from "@cline/core";
import type { InteractiveSlashCommand } from "../../tui/interactive-welcome";
import { listInteractiveSlashCommands } from "../../tui/interactive-welcome";
import {
	type ChatCommandHost,
	chatCommandHost,
} from "../../utils/chat-commands";
import type { MutableUserInstructionConfigService } from "../../utils/mutable-user-instruction-service";
import {
	createWorkspaceChatCommandHost,
	type WorkspaceChatCommandHostResult,
} from "../../utils/plugin-chat-commands";

export interface InteractiveWorkspaceLocation {
	cwd: string;
	workspaceRoot: string;
}

export interface InteractiveWorkspaceCommandSnapshot {
	location: InteractiveWorkspaceLocation;
	workflowSlashCommands: InteractiveSlashCommand[];
	pluginSlashCommands: InteractiveSlashCommand[];
}

interface WorkspacePluginCommands {
	host: ChatCommandHost;
	commands: InteractiveSlashCommand[];
	shutdown?: () => Promise<void>;
}

function toPluginCommands(
	result: WorkspaceChatCommandHostResult,
): WorkspacePluginCommands {
	return {
		host: result.host,
		commands: result.pluginSlashCommands.map((command) => ({
			name: command.name,
			instructions: "",
			description: command.description ?? "Plugin command",
		})),
		shutdown: result.shutdown,
	};
}

export function createInteractiveWorkspaceResources(input: {
	initialLocation: InteractiveWorkspaceLocation;
	userInstructionService: MutableUserInstructionConfigService;
	createUserInstructionService: (
		location: InteractiveWorkspaceLocation,
	) => UserInstructionConfigService;
	logger?: BasicLogger;
	createPluginCommands?: (
		location: InteractiveWorkspaceLocation,
	) => Promise<WorkspaceChatCommandHostResult>;
	onCommandsChanged?: (snapshot: InteractiveWorkspaceCommandSnapshot) => void;
}) {
	let location = input.initialLocation;
	let pluginCommands: WorkspacePluginCommands = {
		host: chatCommandHost,
		commands: [],
	};
	let generation = 0;
	let disposed = false;
	let pluginCommandsLoaded = false;
	let pluginLoadPromise: Promise<InteractiveSlashCommand[]> | undefined;
	let workspaceChangePromise: Promise<void> | undefined;
	const createPluginCommands = async (next: InteractiveWorkspaceLocation) =>
		toPluginCommands(
			await (input.createPluginCommands
				? input.createPluginCommands(next)
				: createWorkspaceChatCommandHost({
						cwd: next.cwd,
						workspaceRoot: next.workspaceRoot,
						logger: input.logger,
					})),
		);
	const snapshot = (): InteractiveWorkspaceCommandSnapshot => ({
		location,
		workflowSlashCommands: listInteractiveSlashCommands(
			input.userInstructionService,
		),
		pluginSlashCommands: pluginCommands.commands,
	});

	const loadPluginSlashCommands = async (): Promise<
		InteractiveSlashCommand[]
	> => {
		if (disposed) {
			return [];
		}
		if (pluginCommandsLoaded) {
			return pluginCommands.commands;
		}
		if (pluginLoadPromise) {
			return await pluginLoadPromise;
		}
		const loadGeneration = generation;
		const loadLocation = location;
		const load = (async () => {
			const loaded = await createPluginCommands(loadLocation);
			if (disposed || generation !== loadGeneration) {
				await loaded.shutdown?.().catch(() => {});
				return pluginCommands.commands;
			}
			const previous = pluginCommands;
			pluginCommands = loaded;
			pluginCommandsLoaded = true;
			await previous.shutdown?.().catch(() => {});
			return loaded.commands;
		})();
		pluginLoadPromise = load;
		try {
			return await load;
		} finally {
			if (pluginLoadPromise === load) {
				pluginLoadPromise = undefined;
			}
		}
	};

	const applyWorkspaceChange = async (
		next: InteractiveWorkspaceLocation,
		applySessionChange: (
			userInstructionService: UserInstructionConfigService,
		) => Promise<void>,
	): Promise<void> => {
		if (disposed) {
			throw new Error("interactive workspace resources are disposed");
		}
		generation += 1;
		const nextService = input.createUserInstructionService(next);
		let nextPluginCommands: WorkspacePluginCommands | undefined;
		try {
			await nextService.start();
			input.userInstructionService.assertCompatible(nextService);
			nextPluginCommands = await createPluginCommands(next);
			// The replacement session receives the staged service directly, so it
			// snapshots the new workspace without exposing that delegate elsewhere
			// before the session transition commits.
			await applySessionChange(nextService);
		} catch (error) {
			try {
				nextService.stop();
			} catch {}
			await nextPluginCommands?.shutdown?.().catch(() => {});
			throw error;
		}

		const previousService = input.userInstructionService.replace(nextService);
		const previousPluginCommands = pluginCommands;
		location = next;
		pluginCommands = nextPluginCommands;
		pluginCommandsLoaded = true;
		// The instruction delegate, plugin host, and TUI catalog become visible as
		// one workspace snapshot after the replacement agent session is live.
		try {
			input.onCommandsChanged?.(snapshot());
		} catch (error) {
			input.logger?.log("workspace command catalog notification failed", {
				error,
			});
		}
		try {
			previousService.stop();
		} catch {}
		await previousPluginCommands.shutdown?.().catch(() => {});
	};

	const changeWorkspace = (
		next: InteractiveWorkspaceLocation,
		applySessionChange: (
			userInstructionService: UserInstructionConfigService,
		) => Promise<void>,
	): Promise<void> => {
		let change: Promise<void>;
		change = (async () => {
			await workspaceChangePromise?.catch(() => {});
			await applyWorkspaceChange(next, applySessionChange);
		})().finally(() => {
			if (workspaceChangePromise === change) {
				workspaceChangePromise = undefined;
			}
		});
		workspaceChangePromise = change;
		return change;
	};

	const dispose = async (): Promise<void> => {
		if (disposed) {
			return;
		}
		disposed = true;
		generation += 1;
		await workspaceChangePromise?.catch(() => {});
		await pluginLoadPromise?.catch(() => {});
		await pluginCommands.shutdown?.().catch(() => {});
		pluginCommands = { host: chatCommandHost, commands: [] };
		pluginCommandsLoaded = false;
	};

	return {
		changeWorkspace,
		dispose,
		getChatCommandHost: () => pluginCommands.host,
		getCommandSnapshot: snapshot,
		arePluginCommandsLoaded: () => pluginCommandsLoaded,
		loadPluginSlashCommands,
	};
}
