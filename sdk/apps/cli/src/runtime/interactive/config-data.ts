import {
	createCoreSettingsService,
	setDisabledPlugin,
	setDisabledTools,
	type UserInstructionConfigService,
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

	return {
		loadConfigData,
		onToggleConfigItem,
	};
}
