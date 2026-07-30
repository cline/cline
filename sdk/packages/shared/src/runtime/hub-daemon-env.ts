export const CLINE_RUN_AS_HUB_DAEMON_ENV = "CLINE_RUN_AS_HUB_DAEMON";
export const CLINE_CONNECTOR_CLI_LAUNCH_ENV = "CLINE_CONNECTOR_CLI_LAUNCH";
export const CLINE_CONNECTOR_STARTING_INSTANCE_ENV =
	"CLINE_CONNECTOR_STARTING_INSTANCE";

export interface ConnectorCliLaunchSpec {
	launcher: string;
	connectArgsPrefix: string[];
	cwd: string;
}

/** Identifies one connector instance: an adapter channel plus its instance id. */
export interface ConnectorInstanceRef {
	channel: string;
	instanceId: string;
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

/**
 * Announce the connector instance this process is in the middle of starting.
 *
 * A connector starts its own hub daemon, and the daemon then reconnects every
 * persisted connector. The instance doing the starting is not yet registered as
 * active when the daemon boots, so without this marker the daemon launches a
 * second copy of it - two processes holding the same bot token. The daemon
 * inherits this variable from the connector that spawned it, so it can tell
 * "the connector that is bringing me up" apart from "a connector left over from
 * a previous hub session", which genuinely does need restarting.
 */
export function setStartingConnectorInstance(
	ref: ConnectorInstanceRef,
	env: Record<string, string | undefined> = process.env,
): void {
	env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV] = JSON.stringify(ref);
}

export function readStartingConnectorInstance(
	env: Record<string, string | undefined> = process.env,
): ConnectorInstanceRef | undefined {
	const raw = env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<ConnectorInstanceRef>;
		if (
			typeof parsed.channel !== "string" ||
			!parsed.channel.trim() ||
			typeof parsed.instanceId !== "string" ||
			!parsed.instanceId.trim()
		) {
			return undefined;
		}
		return { channel: parsed.channel, instanceId: parsed.instanceId };
	} catch {
		return undefined;
	}
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
