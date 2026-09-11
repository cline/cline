import {
	CLINE_CONNECTOR_CLI_LAUNCH_ENV,
	readConnectorCliLaunchSpec,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	configureMenubarConnectorCliLaunch,
	resolveMenubarConnectorCliLaunchSpec,
} from "./connector-cli-launch";

describe("menubar connector CLI launch", () => {
	it("uses the workspace CLI source when it is available", () => {
		expect(
			resolveMenubarConnectorCliLaunchSpec("/repo", {
				env: {},
				execPath: "/usr/local/bin/bun",
				exists: (path) => path === "/repo/apps/cli/src/index.ts",
			}),
		).toEqual({
			launcher: "/usr/local/bin/bun",
			connectArgsPrefix: [
				"--conditions=development",
				"/repo/apps/cli/src/index.ts",
				"connect",
			],
			cwd: "/repo",
		});
	});

	it("honors an explicit installed CLI path", () => {
		expect(
			resolveMenubarConnectorCliLaunchSpec("/workspace", {
				env: { CLINE_CLI_PATH: "/Applications/Cline/bin/cline" },
				exists: () => false,
			}),
		).toEqual({
			launcher: "/Applications/Cline/bin/cline",
			connectArgsPrefix: ["connect"],
			cwd: "/workspace",
		});
	});

	it("registers the launch specification for the detached daemon", () => {
		const env: NodeJS.ProcessEnv = {};
		configureMenubarConnectorCliLaunch(
			"/workspace",
			{ env: {}, exists: () => false },
			env,
		);

		expect(env[CLINE_CONNECTOR_CLI_LAUNCH_ENV]).toBeDefined();
		expect(readConnectorCliLaunchSpec(env)).toEqual({
			launcher: "cline",
			connectArgsPrefix: ["connect"],
			cwd: "/workspace",
		});
	});
});
