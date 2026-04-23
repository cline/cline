import {
	clearHubDiscovery,
	createLocalHubScheduleRuntimeHandlers,
	ensureHubServer,
	probeHubServer,
	readHubDiscovery,
	resolveSharedHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@clinebot/core";
import { Command } from "commander";

interface HubCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

async function stopHubServer(_workspaceRoot: string): Promise<boolean> {
	const owner = resolveSharedHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (await stopLocalHubServerGracefully()) {
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
			const result = await ensureHubServer({
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			io.writeln(result.url);
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
			const result = await ensureHubServer({
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
			io.writeln(result.url);
			if (!result.server) {
				return;
			}
			await new Promise<void>((resolve) => {
				const shutdown = () => resolve();
				process.once("SIGINT", shutdown);
				process.once("SIGTERM", shutdown);
			});
			await result.server.close();
		}),
	);

	hub.command("status").action(
		action(async () => {
			const owner = resolveSharedHubOwnerContext();
			const discovery = await readHubDiscovery(owner.discoveryPath);
			const health = discovery?.url
				? await probeHubServer(discovery.url)
				: undefined;
			io.writeln(
				JSON.stringify({
					running: !!health?.url,
					url: health?.url,
					pid: health?.pid,
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

	return hub;
}
