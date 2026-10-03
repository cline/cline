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

async function stopHubServer(_workspaceRoot: string): Promise<boolean> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (await stopLocalHubServerGracefully(owner)) {
		await clearHubDiscovery(owner.discoveryPath);
		return true;
	}
	const pid = discovery?.pid;
	if (pid) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort
		}
	}
	await clearHubDiscovery(owner.discoveryPath);
	return !!pid;
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

interface EnsureCommandOptions {
	json?: boolean;
	discoveryPath?: string;
	allowPortFallback?: boolean;
	/** Commander maps `--no-connectors` to `connectors: false`. */
	connectors?: boolean;
	loginShellPath?: boolean;
}

/**
 * The connection record `hub ensure --json` prints.
 *
 * Callers that tunnel to the hub (the desktop app's SSH remotes) need the port
 * and path separately rather than having to re-parse the URL, and they need the
 * auth token to attach at all. Port and pathname are derived from the URL the
 * hub actually bound, so they stay correct under `--allow-port-fallback`.
 */
export function describeHubConnection(resolution: {
	url: string;
	authToken: string;
}): {
	url: string;
	authToken: string;
	port: number;
	pathname: string;
} {
	const parsed = new URL(resolution.url);
	return {
		url: resolution.url,
		authToken: resolution.authToken,
		port: Number(parsed.port),
		pathname: parsed.pathname || "/hub",
	};
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
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		})
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--host <host>", "Hub host")
		.option("--port <port>", "Hub port", (value) => Number.parseInt(value, 10))
		.option("--pathname <path>", "Hub websocket path");

	hub
		.command("ensure")
		.description("Start the hub if needed and print how to reach it")
		.option(
			"--json",
			"Print the full connection record (url, authToken, port, pathname) instead of just the URL",
		)
		.option(
			"--discovery-path <path>",
			"Track this hub in a dedicated discovery record instead of the default one",
		)
		.option(
			"--allow-port-fallback",
			"Bind an ephemeral port when the requested one is unavailable",
		)
		.option(
			"--no-connectors",
			"Do not adopt or supervise account-wide connectors",
		)
		.option(
			"--login-shell-path",
			"Merge the login shell's PATH into this process before starting the hub",
		)
		.action(
			action(async (options: EnsureCommandOptions) => {
				const opts = hub.opts<{
					cwd: string;
					host?: string;
					port?: number;
					pathname?: string;
				}>();
				// A non-interactive `ssh host cline hub ensure` runs with a
				// minimal PATH, which the daemon — and everything an agent
				// session spawns under it — would inherit. Opt-in because a
				// local shell already has the login PATH and this costs a
				// shell spawn.
				if (options.loginShellPath) {
					await ensureLoginShellPath();
				}
				// A dedicated discovery record is the isolation boundary for a
				// hub that must not be reused as — or retire — the user's
				// default one. Core reads the owner from this variable.
				if (options.discoveryPath) {
					process.env.CLINE_HUB_DISCOVERY_PATH = options.discoveryPath;
				}
				const result = await ensureDetachedHubServer(opts.cwd, {
					host: opts.host,
					port: opts.port,
					pathname: opts.pathname,
					allowPortFallback: options.allowPortFallback,
					manageConnectors: options.connectors,
				});
				io.writeln(
					options.json
						? JSON.stringify(describeHubConnection(result))
						: result.url,
				);
			}),
		);

	hub.command("start").action(
		action(async () => {
			const opts = hub.opts<{
				cwd: string;
				host?: string;
				port?: number;
				pathname?: string;
			}>();
			const { url } = await ensureDetachedHubServer(opts.cwd, {
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
			});
			io.writeln(url);
		}),
	);

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

	hub
		.command("stop")
		.option(
			"--discovery-path <path>",
			"Stop the hub tracked by this discovery record instead of the default one",
		)
		.action(
			action(async (options: { discoveryPath?: string }) => {
				const opts = hub.opts<{ cwd: string }>();
				// Mirrors `ensure --discovery-path`: this is what lets a caller
				// stop only the hub it started, never the user's default one.
				if (options.discoveryPath) {
					process.env.CLINE_HUB_DISCOVERY_PATH = options.discoveryPath;
				}
				const stopped = await stopHubServer(opts.cwd);
				io.writeln(JSON.stringify({ stopped }));
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
						await stopHubServer(opts.cwd);
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
