import { spawn } from "node:child_process";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	type ConnectorCliLaunchSpec,
	readConnectorCliLaunchSpec,
} from "@cline/shared";
import { listActiveConnectors } from "./active-connectors";
import {
	type ReconnectAttempt,
	reconnectPersistedConnectors,
} from "./connector-autostart";

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
	log: (message: string) => void,
	spawnProcess: SpawnConnectorCli = spawn as SpawnConnectorCli,
): Promise<boolean> {
	const childEnv = { ...process.env };
	delete childEnv[CLINE_RUN_AS_HUB_DAEMON_ENV];

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
				[...spec.connectArgsPrefix, channel, ...args],
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
	const activeChannels = new Set(
		listActiveConnectors().map((record) => record.type),
	);
	return await reconnectPersistedConnectors({
		start: async (channel, args) => {
			if (!launchSpec) {
				log(
					`[connect] cannot reconnect ${channel}: connector CLI launch information is unavailable`,
				);
				return false;
			}
			return await runConnectorCli(launchSpec, channel, args, log);
		},
		isActive: (channel) => activeChannels.has(channel),
		log,
	});
}

export const __test__ = {
	runConnectorCli,
};
