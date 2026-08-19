#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import {
	claimHubDaemonProcess,
	claimSupervisedConnectorProcess,
	disposeAll,
	initVcr,
	setConnectorCliLaunchSpec,
} from "@cline/shared";
import { logCliProcessError } from "./logging/errors";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
	isAbortInProgress,
} from "./runtime/active-runtime";
import { resolveCliLaunchSpec } from "./utils/internal-launch";
import { writeErr } from "./utils/output";

// Initialize VCR before any HTTP requests are made.
// Set CLINE_VCR=record|playback and CLINE_VCR_CASSETTE=<path> to enable.
initVcr(process.env.CLINE_VCR);

if (!isMainThread) {
	// Worker imports of the bundled CLI entrypoint should not start the CLI.
} else if (claimHubDaemonProcess()) {
	// Claim rather than read: the sentinel is consumed here so the processes a
	// daemon-hosted session spawns do not inherit it and try to become daemons.
	// The hub daemon owns its process-level abort handling. Installing the CLI's
	// fatal rejection handler first would make expected abort rejections exit it.
	void import("@cline/core/hub/daemon-entry");
} else {
	// Same reasoning as the daemon sentinel above: consume the supervised-connector
	// marker so the processes an agent session spawns cannot inherit it and mistake
	// themselves for the connector the hub is tracking.
	claimSupervisedConnectorProcess();

	const cliLaunchSpec = resolveCliLaunchSpec({ debugRole: "connector" });
	if (cliLaunchSpec) {
		setConnectorCliLaunchSpec({
			launcher: cliLaunchSpec.launcher,
			connectArgsPrefix: [...cliLaunchSpec.childArgsPrefix, "connect"],
			cwd: process.cwd(),
		});
	}

	let shuttingDown = false;
	let handlingFatalProcessError = false;
	const forwardSignalToRuntime = () => {
		if (shuttingDown) {
			process.exit(1);
		}
		shuttingDown = true;
		abortActiveRuntime();
	};
	process.on("SIGINT", forwardSignalToRuntime);
	process.on("SIGTERM", forwardSignalToRuntime);
	const handleFatalProcessError = (kind: string, error: unknown) => {
		if (handlingFatalProcessError) {
			process.exit(1);
		}
		handlingFatalProcessError = true;
		logCliProcessError(kind, error);
		writeErr(
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		);
		cleanupActiveRuntime();
		abortActiveRuntime();
		void disposeAll().finally(() => {
			process.exit(1);
		});
	};
	process.on("uncaughtException", (error) => {
		handleFatalProcessError("uncaughtException", error);
	});
	process.on("unhandledRejection", (reason, promise) => {
		if (isAbortInProgress()) {
			// Mark the promise as handled so OpenTUI's error overlay
			// does not surface expected abort-related rejections.
			promise.catch(() => {});
			return;
		}
		handleFatalProcessError("unhandledRejection", reason);
	});

	void (async () => {
		let exitCode = 0;
		try {
			const { runCli } = await import("./main");
			await runCli();
		} catch (err) {
			logCliProcessError("runCli", err);
			writeErr(err instanceof Error ? err.message : String(err));
			cleanupActiveRuntime();
			abortActiveRuntime();
			exitCode = 1;
		} finally {
			await disposeAll();
		}
		// The explicit process.exit below means beforeExit never fires, so a
		// startup-recorded auto-update must be applied here, after all runtime
		// teardown. It spawns detached and only when no other CLI is attached.
		try {
			const { applyDeferredUpdate } = await import("./commands/update");
			await applyDeferredUpdate();
		} catch {
			// Best-effort; never block exit on the updater.
		}
		process.exit(exitCode || (process.exitCode as number) || 0);
	})();
}
