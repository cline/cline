import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_WEB_SIDECAR_PORT = 3127;
const SIDECAR_START_TIMEOUT_MS = 30_000;
const SIDECAR_POLL_INTERVAL_MS = 100;

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const sidecarHost = process.env.CLINE_SIDECAR_HOST?.trim() || "127.0.0.1";
const dialHost = sidecarHost === "0.0.0.0" ? "127.0.0.1" : sidecarHost;
const sidecarPort = resolvePort(process.env.CLINE_SIDECAR_PORT);
const defaultWsEndpoint = `ws://${dialHost}:${sidecarPort}/transport`;
const wsEndpoint =
	process.env.NEXT_PUBLIC_SIDECAR_WS_ENDPOINT?.trim() || defaultWsEndpoint;
const healthEndpoint = `http://${dialHost}:${sidecarPort}/health`;

const children: Bun.Subprocess[] = [];
let shuttingDown = false;

function resolvePort(rawPort: string | undefined): number {
	if (!rawPort?.trim()) return DEFAULT_WEB_SIDECAR_PORT;
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid CLINE_SIDECAR_PORT: ${rawPort}`);
	}
	return port;
}

function spawn(
	name: string,
	command: string[],
	env: NodeJS.ProcessEnv,
): Bun.Subprocess {
	const child = Bun.spawn(command, {
		cwd: appRoot,
		env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	children.push(child);
	void child.exited.then((code) => {
		if (!shuttingDown) {
			console.error(`[code:web-dev] ${name} exited with code ${code}`);
			shutdown(code === 0 ? 0 : 1);
		}
	});
	return child;
}

function shutdown(exitCode: number): void {
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

async function isSidecarReady(): Promise<boolean> {
	try {
		const response = await fetch(healthEndpoint, {
			signal: AbortSignal.timeout(500),
		});
		if (!response.ok) return false;
		const health = (await response.json()) as {
			ok?: unknown;
			mode?: unknown;
		};
		return health.ok === true && health.mode === "sidecar";
	} catch {
		return false;
	}
}

async function waitForSidecar(sidecar: Bun.Subprocess): Promise<void> {
	let exitCode: number | undefined;
	void sidecar.exited.then((code) => {
		exitCode = code;
	});

	const deadline = Date.now() + SIDECAR_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (exitCode !== undefined) {
			throw new Error(`Desktop sidecar exited with code ${exitCode}`);
		}
		if (await isSidecarReady()) return;
		await Bun.sleep(SIDECAR_POLL_INTERVAL_MS);
	}
	throw new Error(
		`Desktop sidecar did not become ready at ${healthEndpoint} within ${SIDECAR_START_TIMEOUT_MS}ms`,
	);
}

async function main(): Promise<void> {
	process.on("SIGINT", () => shutdown(0));
	process.on("SIGTERM", () => shutdown(0));

	console.log(
		`[code:web-dev] Starting desktop sidecar at ${defaultWsEndpoint}`,
	);
	const sidecar = spawn("sidecar", [process.execPath, "run", "dev:sidecar"], {
		...process.env,
		CLINE_SIDECAR_PORT: String(sidecarPort),
	});
	await waitForSidecar(sidecar);
	if (shuttingDown) return;

	console.log(`[code:web-dev] Starting Next.js with transport ${wsEndpoint}`);
	spawn("webview", [process.execPath, "run", "dev:web:ui"], {
		...process.env,
		NEXT_PUBLIC_SIDECAR_WS_ENDPOINT: wsEndpoint,
	});

	await Promise.allSettled(children.map((child) => child.exited));
}

void main().catch((error) => {
	console.error(
		`[code:web-dev] ${error instanceof Error ? error.message : String(error)}`,
	);
	shutdown(1);
});
