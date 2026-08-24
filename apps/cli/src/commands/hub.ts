import {
	clearHubDiscovery,
	ensureDetachedHubServer,
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

	hub.command("ensure").action(
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

	hub.command("stop").action(
		action(async () => {
			const opts = hub.opts<{ cwd: string }>();
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
						draining ? "Hub drain request failed." : "Hub un-drain request failed.",
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
