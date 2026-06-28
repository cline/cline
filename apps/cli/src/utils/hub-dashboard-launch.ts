import { buildCliSubcommandCommand } from "./internal-launch";

const DASHBOARD_LAUNCHER_ENV = "CLINE_HUB_DASHBOARD_LAUNCHER";
const DASHBOARD_ARGS_ENV = "CLINE_HUB_DASHBOARD_ARGS";

export function configureCliHubDashboardLaunchEnvironment(): void {
	if (
		process.env[DASHBOARD_LAUNCHER_ENV]?.trim() &&
		process.env[DASHBOARD_ARGS_ENV]?.trim()
	) {
		return;
	}
	const command = buildCliSubcommandCommand("dashboard", ["serve"]);
	if (!command) {
		return;
	}
	process.env[DASHBOARD_LAUNCHER_ENV] = command.launcher;
	process.env[DASHBOARD_ARGS_ENV] = JSON.stringify(command.childArgs);
}
