import {
	createCoreSettingsService,
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
				userInstructionWatcher: input.userInstructionWatcher,
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
		const toolNames = [
			...new Set([...(item.toolNames ?? []), item.name].filter(Boolean)),
		];
		await Promise.all(
			toolNames.map((name) =>
				settings.toggle({
					type: "tools",
					name,
					enabled:
						typeof item.enabled === "boolean" ? !item.enabled : undefined,
					cwd: input.config.cwd,
					workspaceRoot: workspaceRoot(),
					userInstructionWatcher: input.userInstructionWatcher,
					availabilityContext: availabilityContext(),
				}),
			),
		);
		return await loadConfigData();
	};

	return {
		loadConfigData,
		onToggleConfigItem,
	};
}
