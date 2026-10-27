/** Only the explicit fixture Metro resolver loads this module. */
import {
	cloudEnv as shippingCloudEnv,
	env as shippingEnv,
} from "../../src/config/env";

export * from "../../src/config/env";

const base =
	process.env.EXPO_PUBLIC_NATIVE_FIXTURE_BASE || "http://127.0.0.1:4783";
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) {
	throw new Error(
		"The isolated native fixture may only use a loopback server.",
	);
}
export const env = {
	...shippingEnv,
	name: "staging" as const,
	apiBaseUrl: base,
	sessionBaseUrl: base,
};
export const cloudEnv = {
	...shippingCloudEnv,
	name: "staging" as const,
	apiBaseUrl: base,
	appBaseUrl: base,
	workOsBaseUrl: base,
	workOsClientId: "client-native-fixture",
};
