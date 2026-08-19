import { readDesktopSettings } from "./desktop-settings";

/**
 * Env override first; otherwise the user's explicit opt-in from Settings.
 *
 * Cloud sessions are in preview, so the gate is a toggle the user flips in
 * Settings → General (default off) rather than a remote rollout flag. If a
 * PostHog flag is later added to control the toggle's visibility, wire it
 * through the sidecar's get_feature_flags command (see the commented gate in
 * settings-view.tsx).
 */
export function isCloudAgentsEnabled(): boolean {
	const override = process.env.CLINE_CODE_CLOUD_AGENTS?.trim().toLowerCase();
	if (override === "1" || override === "true") {
		return true;
	}
	if (override === "0" || override === "false") {
		return false;
	}
	return readDesktopSettings().cloudSessionsEnabled;
}

/** Independent rollout/kill-switch for local-to-cloud handoff. */
export function isCloudHandoffEnabled(): boolean {
	const override = process.env.CLINE_CODE_CLOUD_HANDOFF?.trim().toLowerCase();
	if (override === "1" || override === "true") {
		return true;
	}
	if (override === "0" || override === "false") {
		return false;
	}
	// Handoff ships enabled on desktop-experimental; Cloud Agents remains a
	// separate required prerequisite through isCloudHandoffAvailable().
	return true;
}

export function isCloudHandoffAvailable(): boolean {
	return isCloudAgentsEnabled() && isCloudHandoffEnabled();
}
