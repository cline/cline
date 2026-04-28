#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import { disposeAll, initVcr } from "@clinebot/shared";
import { logCliProcessError } from "./logging/errors";
import { runCli } from "./main";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
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
	process.on("unhandledRejection", (reason) => {
		handleFatalProcessError("unhandledRejection", reason);
	});

	void (async () => {
		let exitCode = 0;
		try {
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
		process.exit(exitCode || (process.exitCode as number) || 0);
	})();
}
