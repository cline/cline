#!/usr/bin/env node
import {
	claimHubDaemonProcess,
	disableCurrentDirectoryExecutableSearch,
} from "@cline/shared";
import { version } from "../package.json";

disableCurrentDirectoryExecutableSearch();
if (claimHubDaemonProcess()) {
	await import("@cline/core/hub/daemon-entry");
} else {
	try {
		const args = process.argv.slice(2);
		if (args.length === 1 && args[0] === "--version") {
			console.log(version);
		} else if (args.length === 0 || args[0] === "--help") {
			console.log(`Cline Server ${version}
Headless runtime for Cline remote development.

Usage: cline-server --version
       cline-server --remote-hub-info
       cline-server --remote-hub-ensure --discovery-path <path> [--cwd <path>]
       cline-server --remote-hub-stop --discovery-path <path>

Requires Node.js 22 or newer. Hubs listen on loopback; connect through SSH.`);
		} else {
			const { runRemoteHubCommand } = await import("./commands");
			if (!(await runRemoteHubCommand(process.argv))) {
				throw new Error("Unknown command. Run cline-server --help for usage.");
			}
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
	await new Promise<void>((resolve) =>
		process.stdout.write("", () => resolve()),
	);
	process.exit();
}
