import {
	clearHubDiscovery,
	ensureDetachedHubServer,
	ensureLoginShellPath,
	localHubHasNoActiveSessions,
	probeHubServer,
	readHubDiscovery,
	requestHubDrain,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@cline/core";
import { formatUptime, resolveClineBuildEnv } from "@cline/shared";
import { Command, InvalidArgumentError } from "commander";
import { version as cliVersion } from "../../package.json";

interface HubCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

interface HubEnsureCommandOptions {
	json?: boolean;
	allowPortFallback?: boolean;
	connectors?: boolean;
	loginShellPath?: boolean;
}

const HUB_DISCOVERY_PATH_ENV = "CLINE_HUB_DISCOVERY_PATH";

async function stopHubServer(): Promise<boolean> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath, {
		onError: "throw",
	});
	if (!discovery) {
		return true; // Already stopped: cleanup is idempotent.
	}
	if (!(await stopLocalHubServerGracefully(owner))) {
		// A stale PID must never receive a termination signal. A zero-signal
		// existence check can only establish that the recorded process exited;
		// a live/reused PID or a permission error cannot prove shutdown.
		if (!discovery.pid) return false;
		try {
			process.kill(discovery.pid, 0);
			return false;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
		}
	}
	await clearHubDiscovery(owner.discoveryPath);
	return true;
}

function formatHubUptimeFromStartedAt(
	startedAt: string | undefined,
): string | undefined {
	if (!startedAt) {
		return undefined;
	}
	const timestamp = Date.parse(startedAt);
	if (Number.isNaN(timestamp)) {
		return undefined;
	}
	return formatUptime(Date.now() - timestamp);
}

function resolveCliHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

function parseWaitSeconds(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		throw new InvalidArgumentError(
			"--wait requires a non-negative number of seconds.",
		);
	}
	return parsed;
}

export function createHubCommand(
	io: HubCommandIo,
	setExitCode: (code: number) => void,
): Command {
	let actionExitCode = 0;
	const fail = () => {
		actionExitCode = 1;
	};
	const action =
		<T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
		async (...args: T) => {
			try {
				await fn(...args);
			} catch (error) {
				io.writeErr(error instanceof Error ? error.message : String(error));
				fail();
			}
		};

	const hub = new Command("hub")
		.description("Manage the local hub daemon")
		.exitOverride()
		.hook("preAction", () => {
			// Every subcommand resolves its owner record from this env var, so a
			// dedicated record (SSH remote hubs) is honored by ensure, status,
			// and stop alike, and by the daemon the ensure spawns.
			const discoveryPath = hub
				.opts<{ discoveryPath?: string }>()
				.discoveryPath?.trim();
			if (discoveryPath) {
				process.env[HUB_DISCOVERY_PATH_ENV] = discoveryPath;
			}
		})
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		})
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--host <host>", "Hub host")
		.option("--port <port>", "Hub port", (value) => Number.parseInt(value, 10))
		.option("--pathname <path>", "Hub websocket path")
		.option(
			"--discovery-path <path>",
			"Use a dedicated hub discovery record instead of the default one",
		);

	const ensureAction = action(async (cmdOptions: HubEnsureCommandOptions) => {
		const opts = hub.opts<{
			cwd: string;
			host?: string;
			port?: number;
			pathname?: string;
		}>();
		const result = await ensureDetachedHubServer(opts.cwd, {
			host: opts.host,
			port: opts.port,
			pathname: opts.pathname,
			...(cmdOptions.allowPortFallback ? { allowPortFallback: true } : {}),
			...(cmdOptions.connectors === false ? { manageConnectors: false } : {}),
			// Launchers without a login shell (GUI apps, non-interactive SSH)
			// would otherwise hand the daemon a minimal PATH, so agent tools
			// installed from shell profiles could not be found.
			...(cmdOptions.loginShellPath
				? {
						beforeSpawn: async () => {
							await ensureLoginShellPath();
						},
					}
				: {}),
		});
		if (cmdOptions.json) {
			io.writeln(
				JSON.stringify({
					url: result.url,
					authToken: result.authToken,
					cwd: opts.cwd,
					platform: process.platform,
					arch: process.arch,
				}),
			);
			return;
		}
		io.writeln(result.url);
	});
	for (const name of ["ensure", "start"]) {
		hub
			.command(name)
			.description("Start the hub daemon unless a compatible one is running")
			.option(
				"--json",
				"Print the hub URL and auth token as JSON for programmatic clients",
			)
			.option(
				"--allow-port-fallback",
				"Use an OS-assigned port when the requested one is unavailable",
			)
			.option("--no-connectors", "Do not supervise account-wide connectors")
			.option(
				"--login-shell-path",
				"Resolve PATH from the user's login shell before starting the hub",
			)
			.action(ensureAction);
	}

	hub.command("status").action(
		action(async () => {
			const owner = resolveCliHubOwnerContext();
			const discovery = await readHubDiscovery(owner.discoveryPath);
			const health = discovery?.url
				? await probeHubServer(discovery.url, {
						authToken: discovery.authToken,
					})
				: undefined;
			const uptime = formatHubUptimeFromStartedAt(health?.startedAt);
			io.writeln(
				JSON.stringify({
					running: !!health?.url,
					url: health?.url,
					pid: health?.pid,
					startedAt: health?.startedAt,
					uptime,
					cliVersion,
					coreVersion: health?.coreVersion ?? discovery?.coreVersion,
				}),
			);
		}),
	);

	hub.command("stop").action(
		action(async () => {
			const stopped = await stopHubServer();
			io.writeln(JSON.stringify({ stopped }));
			if (!stopped) fail();
		}),
	);

	hub
		.command("drain")
		.description("Refuse new mutating work while accepted runs finish")
		.option("--reason <text>", "Why the hub is draining")
		.option("--off", "Lift the drain and accept new mutating work again")
		.action(
			action(async (cmdOptions: { reason?: string; off?: boolean }) => {
				const owner = resolveCliHubOwnerContext();
				const discovery = await readHubDiscovery(owner.discoveryPath);
				if (!discovery?.url) {
					io.writeErr("No hub is running.");
					fail();
					return;
				}
				const draining = cmdOptions.off !== true;
				const ok = await requestHubDrain(
					discovery.url,
					discovery.authToken,
					cmdOptions.reason ??
						(draining ? "cline hub drain" : "cline hub drain --off"),
					{ off: !draining },
				);
				if (!ok) {
					io.writeErr(
						draining
							? "Hub drain request failed."
							: "Hub un-drain request failed.",
					);
					fail();
					return;
				}
				io.writeln(JSON.stringify({ draining, url: discovery.url }));
			}),
		);

	hub
		.command("upgrade")
		.description(
			"Drain, wait for the hub to go idle, stop it, and start a fresh one",
		)
		.option(
			"--wait <seconds>",
			"How long to wait for the hub to go idle",
			parseWaitSeconds,
			120,
		)
		.action(
			action(async (cmdOptions: { wait: number }) => {
				const opts = hub.opts<{
					cwd: string;
					host?: string;
					port?: number;
					pathname?: string;
				}>();
				const owner = resolveCliHubOwnerContext();
				const discovery = await readHubDiscovery(owner.discoveryPath);
				if (discovery?.url) {
					const drained = await requestHubDrain(
						discovery.url,
						discovery.authToken,
						"cline hub upgrade",
					).catch(() => false);
					// An aborted upgrade must hand the hub back: leaving it
					// draining refuses all new mutating work until a restart.
					const undrain = async (): Promise<void> => {
						if (!drained) {
							return;
						}
						await requestHubDrain(
							discovery.url,
							discovery.authToken,
							"cline hub upgrade aborted",
							{ off: true },
						).catch(() => false);
					};
					try {
						const deadline = Date.now() + cmdOptions.wait * 1_000;
						let idle = false;
						// Check at least once so --wait 0 still observes an idle hub.
						for (;;) {
							idle = await localHubHasNoActiveSessions(
								discovery.url,
								discovery.authToken,
							).catch(() => true);
							if (idle || Date.now() >= deadline) {
								break;
							}
							await new Promise((resolve) => setTimeout(resolve, 1_000));
						}
						if (!idle) {
							await undrain();
							io.writeErr(
								"Hub is still serving sessions after the wait window; not replacing it. Re-run with a longer --wait, or finish the sessions first.",
							);
							fail();
							return;
						}
						if (!(await stopHubServer())) {
							throw new Error("Hub shutdown failed; upgrade aborted.");
						}
					} catch (error) {
						await undrain();
						throw error;
					}
				}
				const { url } = await ensureDetachedHubServer(opts.cwd, {
					host: opts.host,
					port: opts.port,
					pathname: opts.pathname,
				});
				io.writeln(JSON.stringify({ upgraded: true, url }));
			}),
		);

	return hub;
}
