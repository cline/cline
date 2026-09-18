import { ProviderSettingsManager } from "@cline/core";
import { DESKTOP_CLIENT_CONTEXT } from "./client-context";

let manager: ProviderSettingsManager | undefined;
export function getDesktopProviderSettingsManager(): ProviderSettingsManager {
	return (manager ??= new ProviderSettingsManager({
		client: DESKTOP_CLIENT_CONTEXT,
	}));
}
