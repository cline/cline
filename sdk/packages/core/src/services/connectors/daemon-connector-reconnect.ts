import { spawn } from "node:child_process";
import {
	CLINE_CONNECTOR_STARTING_INSTANCE_ENV,
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	type ConnectorCliLaunchSpec,
	readConnectorCliLaunchSpec,
	readStartingConnectorInstance,
} from "@cline/shared";
import { listActiveConnectors } from "./active-connectors";
import {
	type ReconnectAttempt,
	reconnectPersistedConnectors,
} from "./connector-autostart";

/**
 * Env markers a connector sets on its own detached child: the shared
 * `CLINE_CONNECTOR_DETACHED_CHILD` plus one per adapter
 * (`CLINE_SLACK_CONNECT_CHILD`, `CLINE_TELEGRAM_CONNECT_CHILD`, ...). They are
 * owned by the CLI, so match them by shape rather than importing upward.
 */
const CONNECTOR_CHILD_MARKER_PATTERN =
	/^CLINE_(?:CONNECTOR_DETACHED_CHILD|[A-Z0-9]+_CONNECT_CHILD)$/;

type ConnectorCliChild = {
	stderr?: {
		setEncoding: (encoding: string) => void;
		on: (event: "data", listener: (chunk: unknown) => void) => void;
	};
	once: (event: "error" | "close", listener: (value: unknown) => void) => void;
};

type SpawnConnectorCli = (
	launcher: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		stdio: ["ignore", "ignore", "pipe"];
		windowsHide: boolean;
	},
) => ConnectorCliChild;

async function runConnectorCli(
	spec: ConnectorCliLaunchSpec,
	channel: string,
	args: string[],
	options: {
		restartInstanceId?: string;
		log: (message: string) => void;
		spawnProcess?: SpawnConnectorCli;
	},
): Promise<boolean> {
	const { log, restartInstanceId } = options;
	const spawnProcess = options.spawnProcess ?? (spawn as SpawnConnectorCli);
	const childEnv = { ...process.env };
	delete childEnv[CLINE_RUN_AS_HUB_DAEMON_ENV];
	// The daemon inherits its spawning connector's environment, and those
	// markers mean "you are the detached child, skip the already-running check".
	// Leaving them set would make every relaunched connector bypass that check
	// and happily start alongside a live instance holding the same credentials.
	delete childEnv[CLINE_CONNECTOR_STARTING_INSTANCE_ENV];
	for (const key of Object.keys(childEnv)) {
		if (CONNECTOR_CHILD_MARKER_PATTERN.test(key)) {
			delete childEnv[key];
		}
	}

	return await new Promise<boolean>((resolve) => {
		let stderr = "";
		let settled = false;
		const finish = (ok: boolean, message?: string) => {
			if (settled) {
				return;
			}
			settled = true;
			if (message) {
				log(message);
			}
			resolve(ok);
		};

		try {
			const child = spawnProcess(
				spec.launcher,
				[
					...spec.connectArgsPrefix,
					...(restartInstanceId
						? ["--restart-instance", restartInstanceId]
						: []),
					channel,
					...args,
				],
				{
					cwd: spec.cwd,
					env: childEnv,
					stdio: ["ignore", "ignore", "pipe"],
					windowsHide: true,
				},
			);
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk) => {
				stderr += String(chunk);
			});
			child.once("error", (error) => {
				const message = error instanceof Error ? error.message : String(error);
				finish(
					false,
					`[connect] failed to launch ${channel} reconnect: ${message}`,
				);
			});
			child.once("close", (exitCode) => {
				const code = typeof exitCode === "number" ? exitCode : 1;
				finish(
					code === 0,
					code === 0
						? undefined
						: `[connect] ${channel} reconnect exited with code ${code}${
								stderr.trim() ? `: ${stderr.trim()}` : ""
							}`,
				);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			finish(
				false,
				`[connect] failed to launch ${channel} reconnect: ${message}`,
			);
		}
	});
}

/**
 * Restore connectors from the daemon entrypoint through a host-provided CLI
 * launch specification. This keeps connector implementations in the CLI app
 * while allowing the package-owned daemon entrypoint to supervise recovery.
 */
export async function reconnectDaemonConnectors(
	log: (message: string) => void = (message) =>
		process.stderr.write(`[hub-daemon] ${message}\n`),
): Promise<ReconnectAttempt[]> {
	const launchSpec = readConnectorCliLaunchSpec();
	const activeInstances = new Set<string>();
	for (const record of listActiveConnectors()) {
		activeInstances.add(`${record.type}\0${record.instanceId}`);
	}
	// A connector spawns this daemon partway through its own startup, so it is
	// not registered as active yet. Reconnecting it here would put a second
	// process on the same credentials, and for socket-mode adapters both would
	// hold a live connection and split incoming events between them.
	const startingInstance = readStartingConnectorInstance();
	return await reconnectPersistedConnectors({
		isHealthy: ({ channel, instanceId }) =>
			startingInstance?.channel === channel &&
			startingInstance.instanceId === instanceId,
		start: async ({ channel, instanceId, args }) => {
			if (!launchSpec) {
				log(
					`[connect] cannot reconnect ${channel} instance ${instanceId}: connector CLI launch information is unavailable`,
				);
				return false;
			}
			const restartInstanceId = activeInstances.has(`${channel}\0${instanceId}`)
				? instanceId
				: undefined;
			if (restartInstanceId) {
				log(
					`[connect] restarting surviving ${channel} connector ${instanceId} for the new hub session`,
				);
			}
			return await runConnectorCli(launchSpec, channel, args, {
				restartInstanceId,
				log,
			});
		},
		log,
	});
}

export const __test__ = {
	runConnectorCli,
};
