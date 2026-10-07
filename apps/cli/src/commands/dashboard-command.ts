import { Command } from "commander";
import type { RunDashboardCommandOptions } from "./dashboard";

export function createDashboardCommand(
	io: RunDashboardCommandOptions["io"],
	setExitCode: (code: number) => void,
): Command {
	const dashboardCmd = new Command("dashboard")
		.description("Start the Cline Hub dashboard and open it in a browser")
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Workspace root", process.cwd())
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("--host <host>", "Dashboard bind host")
		.option("--port <port>", "Dashboard HTTP/WebSocket port")
		.option("--public-url <url>", "Public dashboard URL")
		.option("--room-secret <secret>", "Invite secret for browser access")
		.option("--no-open", "Start the dashboard without opening a browser")
		.action(async () => {
			const opts = dashboardCmd.opts<{
				config?: string;
				cwd?: string;
				dataDir?: string;
				host?: string;
				port?: string;
				publicUrl?: string;
				roomSecret?: string;
				open?: boolean;
			}>();
			const { runDashboardCommand } = await import("./dashboard");
			setExitCode(
				await runDashboardCommand({
					configDir: opts.config,
					cwd: opts.cwd,
					dataDir: opts.dataDir,
					host: opts.host,
					port: opts.port,
					publicUrl: opts.publicUrl,
					roomSecret: opts.roomSecret,
					openBrowser: opts.open !== false,
					io,
				}),
			);
		});

	return dashboardCmd;
}
