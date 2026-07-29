import { join } from "node:path";
import process from "node:process";
import { resolveAvailablePort } from "./port";

const webviewHost =
	process.env.CLINE_HUB_WEBVIEW_DEV_HOST?.trim() || "127.0.0.1";
const preferredWebviewPort = Number.parseInt(
	process.env.CLINE_HUB_WEBVIEW_DEV_PORT?.trim() || "5173",
	10,
);
const webviewPortExplicit = Boolean(
	process.env.CLINE_HUB_WEBVIEW_DEV_PORT?.trim(),
);

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
		if (shuttingDown) return;
		console.error(`[cline-hub:dev] ${name} exited with code ${code}`);
		shutdown(code === 0 ? 0 : 1);
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

const webviewPort = webviewPortExplicit
	? preferredWebviewPort
	: await resolveAvailablePort(webviewHost, preferredWebviewPort);
if (webviewPort !== preferredWebviewPort) {
	console.log(
		`[cline-hub:dev] preferred webview port ${preferredWebviewPort} is busy; using ${webviewPort}.`,
	);
}

const webviewDevServerUrl =
	process.env.VITE_DEV_SERVER_URL?.trim() ||
	`http://${webviewHost}:${webviewPort}`;

console.log(`[cline-hub:dev] Vite webview: ${webviewDevServerUrl}`);
console.log(
	"[cline-hub:dev] Hub dashboard URL is printed by the server process (port is chosen automatically when free).",
);

const viteArgs = [
	"bun",
	"run",
	"dev",
	"--host",
	webviewHost,
	"--port",
	String(webviewPort),
];
if (webviewPortExplicit) {
	viteArgs.push("--strictPort");
}

spawn("webview", viteArgs, {
	cwd: webviewCwd,
	env: process.env,
});

spawn("server", ["bun", "run", "src/server.ts"], {
	cwd,
	env: {
		...process.env,
		VITE_DEV_SERVER_URL: webviewDevServerUrl,
	},
});

await Promise.allSettled(children.map((child) => child.exited));
