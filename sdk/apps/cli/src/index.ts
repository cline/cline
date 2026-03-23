#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import { initVcr } from "@clinebot/shared";
import { shutdownCliLoggerAdapters } from "./logging/adapter";
import { runCli } from "./main";
import { abortActiveRuntime } from "./runtime/active-runtime";
import { writeErr } from "./utils/output";
import { disposeCliTelemetryService } from "./utils/telemetry";

// Initialize VCR before any HTTP requests are made.
// Set CLINE_VCR=record|playback and CLINE_VCR_CASSETTE=<path> to enable.
initVcr(process.env.CLINE_VCR);

if (!isMainThread) {
	// Worker imports of the bundled CLI entrypoint should not start the CLI.
} else {
	void (async () => {
		let exitCode = 0;
		try {
			await runCli();
		} catch (err) {
			writeErr(err instanceof Error ? err.message : String(err));
			abortActiveRuntime();
			exitCode = 1;
		} finally {
			await disposeCliTelemetryService().catch(() => {});
			shutdownCliLoggerAdapters();
		}
		process.exit(exitCode || (process.exitCode as number) || 0);
	})();
}
