import type {
	AgentExtension,
	CreateEnterprisePluginOptions,
} from "../contracts";
import { prepareEnterpriseRuntime } from "./prepare";

export function createEnterprisePlugin(
	options: CreateEnterprisePluginOptions,
): AgentExtension {
	return {
		name: options.pluginName ?? "enterprise",
		manifest: { capabilities: ["providers"] },
		async setup(api) {
			api.registerProvider?.({
				name: options.pluginName ?? "enterprise",
				description: "Enterprise-managed runtime integration",
			});
			if (options.syncOnSetup === false) {
				return;
			}
			await prepareEnterpriseRuntime({
				...options,
				requireBundle: false,
			});
		},
	};
}
