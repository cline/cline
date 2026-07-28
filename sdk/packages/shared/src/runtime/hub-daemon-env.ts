export const CLINE_RUN_AS_HUB_DAEMON_ENV = "CLINE_RUN_AS_HUB_DAEMON";
export const CLINE_CONNECTOR_CLI_LAUNCH_ENV = "CLINE_CONNECTOR_CLI_LAUNCH";

export interface ConnectorCliLaunchSpec {
	launcher: string;
	connectArgsPrefix: string[];
	cwd: string;
}

export function isHubDaemonProcess(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1";
}

export function setConnectorCliLaunchSpec(
	spec: ConnectorCliLaunchSpec,
	env: Record<string, string | undefined> = process.env,
): void {
	env[CLINE_CONNECTOR_CLI_LAUNCH_ENV] = JSON.stringify(spec);
}

export function readConnectorCliLaunchSpec(
	env: Record<string, string | undefined> = process.env,
): ConnectorCliLaunchSpec | undefined {
	const raw = env[CLINE_CONNECTOR_CLI_LAUNCH_ENV];
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<ConnectorCliLaunchSpec>;
		if (
			typeof parsed.launcher !== "string" ||
			!parsed.launcher.trim() ||
			!Array.isArray(parsed.connectArgsPrefix) ||
			!parsed.connectArgsPrefix.every((arg) => typeof arg === "string") ||
			typeof parsed.cwd !== "string" ||
			!parsed.cwd.trim()
		) {
			return undefined;
		}
		return {
			launcher: parsed.launcher,
			connectArgsPrefix: parsed.connectArgsPrefix,
			cwd: parsed.cwd,
		};
	} catch {
		return undefined;
	}
}
