export const BEDROCK_CODER_RUN_AS_HUB_DAEMON_ENV = "BEDROCK_CODER_RUN_AS_HUB_DAEMON";

export function isHubDaemonProcess(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env[BEDROCK_CODER_RUN_AS_HUB_DAEMON_ENV] === "1";
}
