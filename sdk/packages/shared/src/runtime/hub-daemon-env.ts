export const CLINE_RUN_AS_HUB_DAEMON_ENV = "CLINE_RUN_AS_HUB_DAEMON";
export const CLINE_CONNECTOR_CLI_LAUNCH_ENV = "CLINE_CONNECTOR_CLI_LAUNCH";
export const CLINE_CONNECTOR_STARTING_INSTANCE_ENV =
	"CLINE_CONNECTOR_STARTING_INSTANCE";
export const CLINE_CONNECTOR_SUPERVISED_ENV = "CLINE_CONNECTOR_SUPERVISED";
export const CLINE_HUB_LAUNCHER_CLIENT_ENV = "CLINE_HUB_LAUNCHER_CLIENT";
export const CLINE_HUB_LAUNCHER_VERSION_ENV = "CLINE_HUB_LAUNCHER_VERSION";
export const CLINE_HUB_LAUNCHER_TRANSPORT_ENV = "CLINE_HUB_LAUNCHER_TRANSPORT";

/**
 * Which Cline client started a Hub daemon. The daemon is one shared process
 * per machine and any client attaches to it, so a session's own client
 * identity (desktop, CLI, extension) says nothing about whose build is
 * hosting it. The spawner stamps this into the daemon's environment and the
 * daemon publishes it as OTel resource attributes, so a trace from a desktop
 * session can be read as "served by the hub the CLI started" (or vice versa).
 */
export interface HubLauncherIdentity {
	/** Client name of the spawner, e.g. `cline-desktop`, `cline-cli`. */
	client: string;
	version?: string;
	/** `local` for a daemon on the client's own machine, `ssh` for a remote one. */
	transport?: "local" | "ssh";
}

/**
 * Stamp the launcher identity onto a daemon environment. A launcher already
 * in `env` is kept as a whole: an embedding host (the desktop app running
 * `cline-cli hub ensure`) stamps itself before handing the spawn to the CLI,
 * and filling in fields it left unset from the CLI's identity would pair the
 * host's name with another build's version.
 */
export function withHubLauncherIdentity<
	T extends Record<string, string | undefined>,
>(env: T, identity: HubLauncherIdentity | undefined): T {
	if (env[CLINE_HUB_LAUNCHER_CLIENT_ENV]?.trim()) {
		return env;
	}
	const client = identity?.client?.trim();
	if (!client) {
		return env;
	}
	const version = identity?.version?.trim();
	return {
		...env,
		[CLINE_HUB_LAUNCHER_CLIENT_ENV]: client,
		...(version ? { [CLINE_HUB_LAUNCHER_VERSION_ENV]: version } : {}),
		[CLINE_HUB_LAUNCHER_TRANSPORT_ENV]: identity?.transport ?? "local",
	};
}

/**
 * Take the launcher stamp out of a daemon's environment, returning it.
 *
 * Same hazard as {@link claimHubDaemonProcess}: everything a hub-hosted
 * session spawns inherits the daemon's environment. A shell command that
 * starts its own hub (`cline hub ensure --discovery-path ...`) would
 * otherwise keep the outer hub's stamp, and a local CLI hub started inside
 * an SSH-hosted session would report the desktop launcher and `ssh`.
 */
export function claimHubLauncherIdentity(
	env: Record<string, string | undefined> = process.env,
): HubLauncherIdentity | undefined {
	const identity = readHubLauncherIdentity(env);
	delete env[CLINE_HUB_LAUNCHER_CLIENT_ENV];
	delete env[CLINE_HUB_LAUNCHER_VERSION_ENV];
	delete env[CLINE_HUB_LAUNCHER_TRANSPORT_ENV];
	return identity;
}

export function readHubLauncherIdentity(
	env: Record<string, string | undefined> = process.env,
): HubLauncherIdentity | undefined {
	const client = env[CLINE_HUB_LAUNCHER_CLIENT_ENV]?.trim();
	if (!client) {
		return undefined;
	}
	const version = env[CLINE_HUB_LAUNCHER_VERSION_ENV]?.trim();
	const transport = env[CLINE_HUB_LAUNCHER_TRANSPORT_ENV]?.trim();
	return {
		client,
		...(version ? { version } : {}),
		...(transport === "ssh" || transport === "local" ? { transport } : {}),
	};
}

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

/**
 * Latched result of {@link claimHubDaemonProcess}, so the sentinel can be
 * removed from the environment while the process still knows what it is.
 */
let claimedHubDaemonProcess: boolean | undefined;

/**
 * Take the daemon sentinel out of the environment, remembering its value.
 *
 * The sentinel selects which personality the shared CLI binary boots, so it must
 * not outlive that decision: the hub daemon hosts session runtimes, and every
 * process a session spawns - agent shell commands, MCP servers, hooks, plugin
 * sandboxes - inherits its environment. An inherited sentinel makes each of
 * those try to become a hub daemon instead of running the command, and they die
 * on EADDRINUSE against the real hub. Observed as every `cline` invocation from
 * a Slack connector agent failing, `cline --help` included, because the
 * personality is chosen before any argument parsing.
 *
 * Call this once from an entrypoint, in place of {@link isHubDaemonProcess}.
 * Spawn paths that deliberately start a daemon set the variable explicitly on
 * the child environment, so they are unaffected.
 */
export function claimHubDaemonProcess(
	env: Record<string, string | undefined> = process.env,
): boolean {
	claimedHubDaemonProcess = env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1";
	delete env[CLINE_RUN_AS_HUB_DAEMON_ENV];
	return claimedHubDaemonProcess;
}

/**
 * Whether this process is the hub daemon.
 *
 * Reads the latch first so callers still get the right answer after
 * {@link claimHubDaemonProcess} has scrubbed the environment - notably the
 * guards that stop a daemon from spawning another daemon. An explicitly passed
 * environment is always read verbatim.
 */
export function isHubDaemonProcess(
	env?: Record<string, string | undefined>,
): boolean {
	if (env) {
		return env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1";
	}
	return (
		claimedHubDaemonProcess ?? process.env[CLINE_RUN_AS_HUB_DAEMON_ENV] === "1"
	);
}

export function setConnectorCliLaunchSpec(
	spec: ConnectorCliLaunchSpec,
	env: Record<string, string | undefined> = process.env,
): void {
	env[CLINE_CONNECTOR_CLI_LAUNCH_ENV] = JSON.stringify(spec);
}

/** Latched result of {@link claimSupervisedConnectorProcess}. */
let claimedSupervisedConnectorProcess: boolean | undefined;

/**
 * Take the supervised-connector marker out of the environment, remembering it.
 *
 * Same hazard as {@link claimHubDaemonProcess}: a supervised connector hosts
 * agent sessions, and everything they spawn — shell commands, MCP servers, hooks
 * — inherits its environment. An inherited marker makes a nested `cline connect`
 * think it is the process the hub is tracking, so it runs the connector in the
 * foreground of that shell command instead of handing it to the hub.
 *
 * Call once from an entrypoint, in place of
 * {@link isSupervisedConnectorProcess}. The supervisor sets the marker
 * explicitly on the child environment, so it is unaffected.
 */
export function claimSupervisedConnectorProcess(
	env: Record<string, string | undefined> = process.env,
): boolean {
	claimedSupervisedConnectorProcess =
		env[CLINE_CONNECTOR_SUPERVISED_ENV] === "1";
	delete env[CLINE_CONNECTOR_SUPERVISED_ENV];
	return claimedSupervisedConnectorProcess;
}

/**
 * True in a connector process the hub supervisor launched.
 *
 * Such a process must run the connector itself rather than doing what a
 * user-invoked background `connect` does — asking the hub to start it (which
 * would loop straight back here) or spawning its own detached child and exiting
 * (which would leave the supervisor holding a handle to a process that is
 * already gone).
 *
 * Reads the latch first so callers still get the right answer after
 * {@link claimSupervisedConnectorProcess} has scrubbed the environment. An
 * explicitly passed environment is always read verbatim.
 */
export function isSupervisedConnectorProcess(
	env?: Record<string, string | undefined>,
): boolean {
	if (env) {
		return env[CLINE_CONNECTOR_SUPERVISED_ENV] === "1";
	}
	return (
		claimedSupervisedConnectorProcess ??
		process.env[CLINE_CONNECTOR_SUPERVISED_ENV] === "1"
	);
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
