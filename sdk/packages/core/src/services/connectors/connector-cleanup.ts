import { spawn } from "node:child_process";
import {
	type ConnectorCliLaunchSpec,
	readConnectorCliLaunchSpec,
} from "@cline/shared";
import { buildConnectorChildEnv } from "./connector-child-env";

const CLEANUP_TIMEOUT_MS = 15_000;

export interface CleanupConnectorInstanceOptions {
	launchSpec?: ConnectorCliLaunchSpec | undefined;
	spawnProcess?: typeof spawn;
	timeoutMs?: number;
}

/**
 * Reap one dead connector instance through the CLI.
 *
 * What has to be cleaned up — the process state file, thread→session bindings,
 * and the hub sessions the connector owned — is all connector-specific knowledge
 * that lives in the CLI's adapters. Rather than duplicate those conventions in
 * the hub, the supervisor shells back into the CLI's own stop path, which
 * already does exactly this for a process that is no longer running.
 *
 * `--cleanup-instance` deliberately preserves the autostart record: the instance
 * died, it was not retired, so the supervisor still intends to restart it.
 */
export async function cleanupConnectorInstanceViaCli(
	channel: string,
	instanceId: string,
	options: CleanupConnectorInstanceOptions = {},
): Promise<void> {
	const spec =
		"launchSpec" in options ? options.launchSpec : readConnectorCliLaunchSpec();
	if (!spec) {
		throw new Error("connector CLI launch information is unavailable");
	}
	const spawnProcess = options.spawnProcess ?? spawn;
	const timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawnProcess(
				spec.launcher,
				[
					...spec.connectArgsPrefix,
					// Flags must precede the channel: `connect` uses passThroughOptions,
					// so anything after the channel name is handed to the adapter.
					"--cleanup-instance",
					instanceId,
					channel,
				],
				{
					cwd: spec.cwd,
					env: buildConnectorChildEnv(),
					stdio: ["ignore", "ignore", "pipe"],
					windowsHide: true,
				},
			);
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		let stderr = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: unknown) => {
			stderr += String(chunk);
		});
		timer = setTimeout(() => {
			// A hung cleanup must not wedge the supervisor's restart path.
			try {
				child.kill("SIGKILL");
			} catch {
				// Nothing further to do; the timeout is reported either way.
			}
			finish(new Error(`cleanup timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref?.();
		child.once("error", (error: unknown) => {
			finish(error instanceof Error ? error : new Error(String(error)));
		});
		child.once("close", (code: number | null) => {
			if (code === 0 || code === null) {
				finish();
				return;
			}
			finish(
				new Error(
					`cleanup exited with code ${code}${
						stderr.trim() ? `: ${stderr.trim()}` : ""
					}`,
				),
			);
		});
	});
}
