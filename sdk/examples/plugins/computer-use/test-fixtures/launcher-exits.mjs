// Daemonizing launcher for tests: spawns the fake backend detached and then
// exits, like real launch commands that hand the backend off to a service.
// Usage: node launcher-exits.mjs <port> <lifetimeMs> [startupDelayMs]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = process.argv[2] ?? "0";
const lifetimeMs = process.argv[3] ?? "0";
const startupDelayMs = process.argv[4] ?? "0";
const backend = fileURLToPath(new URL("./fake-backend.mjs", import.meta.url));
const child = spawn(
	process.execPath,
	[backend, port, lifetimeMs, startupDelayMs],
	{
		detached: true,
		stdio: "ignore",
	},
);
child.unref();
process.exit(0);
