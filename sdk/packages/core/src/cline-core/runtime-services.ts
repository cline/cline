import type {
	PendingPromptsRuntimeService,
	PendingPromptsServiceApi,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionModelRuntimeService,
	SessionUsageRuntimeService,
} from "../runtime/host/runtime-host";
import type {
	PluginCommandsApi,
	PluginCommandsRuntimeService,
} from "../services/plugin-command-api";
import {
	type ClineCoreSettingsApi,
	type CoreSettingsListInput,
	type CoreSettingsMutationResult,
	type CoreSettingsSnapshot,
	type CoreSettingsToggleInput,
	createCoreSettingsService,
} from "../settings";

type RuntimeHostWithSettings = RuntimeHost & {
	listSettings?: (
		input?: CoreSettingsListInput,
	) => Promise<CoreSettingsSnapshot>;
	toggleSetting?: (
		input: CoreSettingsToggleInput,
	) => Promise<CoreSettingsMutationResult>;
};

export type RuntimeHostServiceExtensions = RuntimeHost &
	Partial<
		PendingPromptsRuntimeService &
			SessionUsageRuntimeService &
			SessionConnectionRuntimeService &
			SessionModelRuntimeService
	>;

export function createClineCoreSettingsApi(
	host: RuntimeHost,
): ClineCoreSettingsApi {
	return {
		async list(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.listSettings) {
				return await settingsHost.listSettings(input);
			}
			return await createCoreSettingsService().list(input);
		},
		async toggle(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.toggleSetting) {
				return await settingsHost.toggleSetting(input);
			}
			return await createCoreSettingsService().toggle(input);
		},
	};
}

export function createClineCorePendingPromptsApi(
	host: RuntimeHost,
): PendingPromptsServiceApi {
	function getService(): PendingPromptsServiceApi {
		const service = (host as RuntimeHostServiceExtensions).pendingPrompts;
		if (!service) {
			throw new Error("Pending prompt service is not available.");
		}
		return service;
	}
	return {
		steerFirst(input) {
			return getService().steerFirst(input);
		},
		list(input) {
			return getService().list(input);
		},
		update(input) {
			return getService().update(input);
		},
		delete(input) {
			return getService().delete(input);
		},
	};
}

export function createClineCorePluginCommandsApi(
	host: RuntimeHost,
): PluginCommandsApi {
	const service = () => {
		const api = (host as RuntimeHost & Partial<PluginCommandsRuntimeService>)
			.pluginCommands;
		if (!api)
			throw new Error("Plugin commands are unavailable on this runtime");
		return api;
	};
	return {
		list: (target) => service().list(target),
		run: (input) => service().run(input),
		subscribe: (listener) => service().subscribe(listener),
	};
}
