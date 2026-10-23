/**
 * React Native/browser-safe entrypoint for the existing Cline device-code auth
 * implementation. Keep this surface deliberately narrow: hosts provide their
 * own credential persistence and UI, while the token protocol remains shared
 * with the CLI/TUI.
 */

export {
	type ClineOAuthCredentials,
	type ClineOAuthProviderOptions,
	type ClineTokenResolution,
	completeClineDeviceAuth,
	getValidClineCredentials,
	refreshClineToken,
	startClineDeviceAuth,
} from "./cline";
