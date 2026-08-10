import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_VERSION } from "@cline/hub";
import {
	type HubDaemonLaunchSpec,
	setHubDaemonLaunchSpec,
} from "@cline/shared";

export function resolveDesktopHubDaemonLaunchSpec(
	options: {
		execPath?: string;
		argv?: string[];
		execArgv?: string[];
		cwd?: string;
		platform?: NodeJS.Platform;
	} = {},
): HubDaemonLaunchSpec {
	const execPath = options.execPath?.trim() || process.execPath;
	const argv = options.argv ?? process.argv;
	const cwd = options.cwd ?? process.cwd();
	const entryArg = argv[1]?.trim();
	const sourceEntry =
		entryArg && !entryArg.startsWith("/$bunfs/")
			? isAbsolute(entryArg)
				? entryArg
				: resolve(cwd, entryArg)
			: undefined;
	if (sourceEntry && existsSync(sourceEntry)) {
		const conditionsArg = (options.execArgv ?? process.execArgv).find((arg) =>
			arg.startsWith("--conditions="),
		);
		return {
			launcher: execPath,
			argsPrefix: [
				...(conditionsArg ? [conditionsArg] : ["--conditions=development"]),
				fileURLToPath(
					new URL(
						"../../../../sdk/packages/hub-daemon/src/entry.ts",
						import.meta.url,
					),
				),
			],
			cwd,
			version: HUB_VERSION,
		};
	}
	const extension =
		(options.platform ?? process.platform) === "win32" ? ".exe" : "";
	return {
		launcher: join(dirname(execPath), `code-hub${extension}`),
		argsPrefix: [],
		cwd,
		version: HUB_VERSION,
	};
}

export function configureDesktopHubDaemonLaunch(): void {
	setHubDaemonLaunchSpec(resolveDesktopHubDaemonLaunchSpec());
}
