import type {
	PendingPromptsRuntimeService,
	PendingPromptsServiceApi,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionModelRuntimeService,
	SessionUsageRuntimeService,
} from "../runtime/host/runtime-host";
import type {
	PluginUiApi,
	PluginUiRuntimeService,
} from "../services/plugin-ui-api";
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
			SessionModelRuntimeService &
			PluginUiRuntimeService
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

/**
 * Hosts call this for every session, so it never throws: a host without
 * plugin UI (a cloud session, an older hub) has no slots and no viewers.
 */
export function createClineCorePluginUiApi(host: RuntimeHost): PluginUiApi {
	const service = () => (host as RuntimeHostServiceExtensions).pluginUi;
	return {
		async get(input) {
			try {
				return (await service()?.get(input)) ?? [];
			} catch {
				return [];
			}
		},
		async invoke(input) {
			try {
				return (await service()?.invoke(input)) ?? { outcome: "unavailable" };
			} catch {
				return { outcome: "unavailable" };
			}
		},
	};
}
