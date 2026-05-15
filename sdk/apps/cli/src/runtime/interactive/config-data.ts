import {
	createCoreSettingsService,
	setDisabledPlugin,
	type UserInstructionConfigService,
} from "@cline/core";
import {
	type InteractiveConfigData,
	type InteractiveConfigItem,
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
	const loadConfigData = async (): Promise<InteractiveConfigData> =>
		await loadInteractiveConfigData({
			userInstructionService: input.userInstructionService,
			cwd: input.config.cwd,
			workspaceRoot: workspaceRoot(),
			availabilityContext: availabilityContext(),
		});

	const onToggleConfigItem = async (
		item: InteractiveConfigItem,
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
			return await loadConfigData();
		}

		if (item.kind === "plugin" && typeof item.enabled === "boolean") {
			setDisabledPlugin(item.path, item.enabled);
			return await loadConfigData();
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
			return await loadConfigData();
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
		for (const name of toolNames) {
			await settings.toggle({
				type: "tools",
				name,
				enabled: typeof item.enabled === "boolean" ? !item.enabled : undefined,
				cwd: input.config.cwd,
				workspaceRoot: workspaceRoot(),
				userInstructionService: input.userInstructionService,
				availabilityContext: availabilityContext(),
			});
		}
		return await loadConfigData();
	};

	return {
		loadConfigData,
		onToggleConfigItem,
	};
}
