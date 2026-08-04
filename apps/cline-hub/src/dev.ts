import { join } from "node:path";
import process from "node:process";

const webviewHost =
	process.env.CLINE_HUB_WEBVIEW_DEV_HOST?.trim() || "127.0.0.1";
const webviewPort = process.env.CLINE_HUB_WEBVIEW_DEV_PORT?.trim() || "5173";
const webviewDevServerUrl =
	process.env.VITE_DEV_SERVER_URL?.trim() ||
	`http://${webviewHost}:${webviewPort}`;

const cwd = process.cwd();
const webviewCwd = join(cwd, "src", "webview");

const children: Bun.Subprocess[] = [];
let shuttingDown = false;

function spawn(
	name: string,
	command: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
	},
): Bun.Subprocess {
	const child = Bun.spawn(command, {
		...options,
		stdout: "inherit",
		stderr: "inherit",
	});
	children.push(child);
	void child.exited.then((code) => {
		if (!shuttingDown) {
			console.error(`[cline-hub:dev] ${name} exited with code ${code}`);
			shutdown(code === 0 ? 0 : 1);
		}
	});
	return child;
}

function shutdown(exitCode = 0): void {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		try {
			child.kill();
		} catch {
			// The process may have already exited.
		}
	}
	process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[cline-hub:dev] Vite webview: ${webviewDevServerUrl}`);
console.log("[cline-hub:dev] Hub dashboard: http://127.0.0.1:8787/");

spawn(
	"webview",
	[
		"bun",
		"run",
		"dev",
		"--host",
		webviewHost,
		"--port",
		webviewPort,
		"--strictPort",
	],
	{
		cwd: webviewCwd,
		env: process.env,
	},
);

spawn("server", ["bun", "run", "src/server.ts"], {
	cwd,
	env: {
		...process.env,
		VITE_DEV_SERVER_URL: webviewDevServerUrl,
	},
});

await Promise.allSettled(children.map((child) => child.exited));
