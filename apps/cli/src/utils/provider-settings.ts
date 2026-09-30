import { ProviderSettingsManager } from "@cline/core";
import { getCliBuildInfo } from "./common";

const managers = new Map<string, ProviderSettingsManager>();
export function getCliProviderSettingsManager(
	name = "cline-cli",
): ProviderSettingsManager {
	let manager = managers.get(name);
	if (!manager) {
		const { version } = getCliBuildInfo();
		manager = new ProviderSettingsManager({
			client: { name, version, platform: "cli", platformVersion: version },
		});
		managers.set(name, manager);
	}
	return manager;
}
