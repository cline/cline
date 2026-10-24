/** Cloud sessions are experimental; `CLINE_CLOUD_SESSIONS=1` opts in. */
export function isCloudSessionsEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const value = env.CLINE_CLOUD_SESSIONS?.trim().toLowerCase();
	return value === "1" || value === "true";
}
