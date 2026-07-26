import type { GlobalStateAndSettings } from "@shared/storage/state-keys"

/**
 * Remote enterprise configuration is not supported. This identity filter is
 * retained only until the legacy cache fields are removed from StateManager.
 */
export function filterAllowedRemoteConfigFields(config: Partial<GlobalStateAndSettings>): Partial<GlobalStateAndSettings> {
	return config
}
