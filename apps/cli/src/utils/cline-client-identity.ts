import { setClineClientIdentity } from "@cline/shared";
import { getCliBuildInfo } from "./common";

export function registerClineClientIdentity(name: string): void {
	const { version } = getCliBuildInfo();
	setClineClientIdentity({
		name,
		version,
		platform: "cli",
		platformVersion: version,
	});
}
