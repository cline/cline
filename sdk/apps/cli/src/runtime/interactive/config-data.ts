import {
	toggleDisabledTool,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import {
	type InteractiveConfigData,
	type InteractiveConfigItem,
	loadInteractiveConfigData,
} from "../../tui/interactive-config";
import type { Config } from "../../utils/types";

export function createInteractiveConfigDataLoader(input: {
	config: Config;
	userInstructionWatcher?: UserInstructionConfigWatcher;
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
			watcher: input.userInstructionWatcher,
			cwd: input.config.cwd,
			workspaceRoot: workspaceRoot(),
			availabilityContext: availabilityContext(),
		});

	const onToggleConfigItem = async (
		item: InteractiveConfigItem,
	): Promise<InteractiveConfigData | undefined> => {
		if (item.source !== "workspace-plugin" && item.source !== "global-plugin") {
			return undefined;
		}
		toggleDisabledTool(item.name);
		return await loadConfigData();
	};

	return {
		loadConfigData,
		onToggleConfigItem,
	};
}
