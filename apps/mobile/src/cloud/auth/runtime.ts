import { cloudEnv } from "../../config/env";
import {
	ClineAuthStore,
	createInMemoryAuthStorage,
	createSecureAuthStorage,
} from "./store";

/**
 * Development staging builds may opt into ephemeral credentials when their
 * unsigned runtime cannot access Keychain. The name intentionally describes
 * the flag's real scope: it does not attempt to infer simulator hardware.
 * Production can never silently downgrade credential persistence.
 */
export function shouldUseStagingEphemeralAuth(
	environment: string,
	flag: string | undefined,
): boolean {
	return environment === "staging" && flag === "1";
}

const useStagingEphemeralAuth = shouldUseStagingEphemeralAuth(
	cloudEnv.name,
	process.env.EXPO_PUBLIC_STAGING_EPHEMERAL_AUTH,
);

/** The device-wide Cline account credential store. */
export const cloudAuthStore = new ClineAuthStore({
	storage: useStagingEphemeralAuth
		? createInMemoryAuthStorage()
		: createSecureAuthStorage(),
	apiBaseUrl: cloudEnv.apiBaseUrl,
});
