import {
	createCoreSettingsService,
	disablePluginMcpServersInSettings,
	setDisabledPlugin,
	setDisabledTools,
	syncPluginMcpServersToSettings,
	type UserInstructionConfigService,
	uninstallPlugin,
} from "@cline/core";
import {
	type InteractiveConfigData,
	type InteractiveConfigItem,
	type LoadInteractiveConfigDataOptions,
	loadInteractiveConfigData,
} from "../../tui/interactive-config";
import type { Config } from "../../utils/types";

export function createInteractiveConfigDataLoader(input: {
	config: Config;
	userInstructionService?: UserInstructionConfigService;
}) {
	const workspaceRoot = () =>
		input.config.workspaceRoot?.trim() || input.config.cwd;
	const availabilityContext = () => ({
		mode: input.config.mode,
		modelId: input.config.modelId,
		providerId: input.config.providerId,
		enableSpawnAgent: input.config.enableSpawnAgent,
		enableAgentTeams: input.config.enableAgentTeams,
	});
	const loadConfigData = async (
		options: LoadInteractiveConfigDataOptions = {},
	): Promise<InteractiveConfigData> =>
		await loadInteractiveConfigData({
			userInstructionService: input.userInstructionService,
			cwd: input.config.cwd,
			workspaceRoot: workspaceRoot(),
			availabilityContext: availabilityContext(),
			includePluginTools: options.includePluginTools,
		});

	const refreshUserInstructionConfigs = async (): Promise<void> => {
		const service = input.userInstructionService;
		if (!service) {
			return;
		}
		await Promise.all([
			service.refreshType("workflow"),
			service.refreshType("rule"),
			service.refreshType("skill"),
		]);
	};

	const onToggleConfigItem = async (
		item: InteractiveConfigItem,
		options: LoadInteractiveConfigDataOptions = {},
	): Promise<InteractiveConfigData | undefined> => {
		const settings = createCoreSettingsService();
		if (item.kind === "skill" && typeof item.enabled === "boolean") {
			await settings.toggle({
				type: "skills",
				id: item.id,
				path: item.path,
				name: item.name,
				enabled: !item.enabled,
				cwd: input.config.cwd,
				workspaceRoot: workspaceRoot(),
				userInstructionService: input.userInstructionService,
				availabilityContext: availabilityContext(),
			});
			return await loadConfigData(options);
		}

		if (item.kind === "plugin" && typeof item.enabled === "boolean") {
			setDisabledPlugin(item.path, item.enabled);
			if (item.enabled) {
				disablePluginMcpServersInSettings({ pluginPaths: [item.path] });
			} else {
				const ownedMcpMutations = disablePluginMcpServersInSettings({
					pluginPaths: [item.path],
				});
				const result = await syncPluginMcpServersToSettings({
					pluginPaths: [item.path],
					cwd: input.config.cwd,
					workspacePath: workspaceRoot(),
					providerId: input.config.providerId,
					modelId: input.config.modelId,
				});
				if (ownedMcpMutations.length > 0 && result.failures.length > 0) {
					throw new Error(
						`Failed to sync plugin MCP servers: ${result.failures
							.map((failure) => {
								const plugin = failure.pluginName ?? failure.pluginPath;
								return `${plugin}: ${failure.message}`;
							})
							.join("; ")}`,
					);
				}
			}
			return undefined;
		}

		if (item.kind === "mcp" && typeof item.enabled === "boolean") {
			await settings.toggle({
				type: "mcp",
				id: item.id,
				path: item.path,
				name: item.name,
				enabled: !item.enabled,
				cwd: input.config.cwd,
				workspaceRoot: workspaceRoot(),
				availabilityContext: availabilityContext(),
			});
			return await loadConfigData(options);
		}

		if (
			item.kind !== "tool" ||
			(item.source !== "builtin" &&
				item.source !== "workspace-plugin" &&
				item.source !== "global-plugin")
		) {
			return undefined;
		}
		const rawToolNames =
			item.toolNames && item.toolNames.length > 0
				? item.toolNames
				: [item.name];
		const toolNames = [...new Set(rawToolNames.filter(Boolean))];
		if (typeof item.enabled === "boolean") {
			setDisabledTools(toolNames, item.enabled);
			return undefined;
		}

		for (const name of toolNames) {
			await settings.toggle({
				type: "tools",
				name,
				cwd: input.config.cwd,
				workspaceRoot: workspaceRoot(),
				userInstructionService: input.userInstructionService,
				availabilityContext: availabilityContext(),
			});
		}
		return undefined;
	};

	const onDeleteConfigItem = async (
		item: InteractiveConfigItem,
		options: LoadInteractiveConfigDataOptions = {},
	): Promise<InteractiveConfigData | undefined> => {
		if (item.kind !== "plugin") {
			return undefined;
		}
		await uninstallPlugin({
			path: item.path,
			name: item.name,
			cwd: input.config.cwd,
			workspaceRoot: workspaceRoot(),
		});
		await refreshUserInstructionConfigs();
		return await loadConfigData(options);
	};

	return {
		loadConfigData,
		onToggleConfigItem,
		onDeleteConfigItem,
	};
}
