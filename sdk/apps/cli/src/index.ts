#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import { disposeAll, initVcr, isHubDaemonProcess } from "@cline/shared";
import { logCliProcessError } from "./logging/errors";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
	isAbortInProgress,
} from "./runtime/active-runtime";
import { writeErr } from "./utils/output";

// Initialize VCR before any HTTP requests are made.
// Set CLINE_VCR=record|playback and CLINE_VCR_CASSETTE=<path> to enable.
initVcr(process.env.CLINE_VCR);

if (!isMainThread) {
	// Worker imports of the bundled CLI entrypoint should not start the CLI.
} else {
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
	const handleFatalProcessError = async (kind: string, error: unknown) => {
		if (handlingFatalProcessError) {
			process.exit(1);
		}
		handlingFatalProcessError = true;
		writeErr(
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		);
		cleanupActiveRuntime();
		abortActiveRuntime();
		await logCliProcessError(kind, error);
		await disposeAll().finally(() => {
			process.exit(1);
		});
	};
	process.on("uncaughtException", (error) => {
		void handleFatalProcessError("uncaughtException", error);
	});
	process.on("unhandledRejection", (reason, promise) => {
		if (isAbortInProgress()) {
			// Mark the promise as handled so OpenTUI's error overlay
			// does not surface expected abort-related rejections.
			promise.catch(() => {});
			return;
		}
		void handleFatalProcessError("unhandledRejection", reason);
	});

	void (async () => {
		if (isHubDaemonProcess()) {
			await import("@cline/core/hub/daemon-entry");
			return;
		}

		let exitCode = 0;
		try {
			const { runCli } = await import("./main");
			await runCli();
		} catch (err) {
			writeErr(err instanceof Error ? err.message : String(err));
			cleanupActiveRuntime();
			abortActiveRuntime();
			await logCliProcessError("runCli", err);
			exitCode = 1;
		} finally {
			await disposeAll();
		}
		process.exit(exitCode || (process.exitCode as number) || 0);
	})();
}
