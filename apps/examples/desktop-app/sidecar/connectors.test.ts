import {
	CLINE_CONNECTOR_CLI_LAUNCH_ENV,
	readConnectorCliLaunchSpec,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { __test__, configureConnectorCliLaunch } from "./connectors";

describe("desktop connector lifecycle", () => {
	const originalLaunchSpec = process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV];

	afterEach(() => {
		if (originalLaunchSpec === undefined) {
			delete process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV];
		} else {
			process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV] = originalLaunchSpec;
		}
	});

	it("registers the CLI connect command for a desktop-started daemon", () => {
		const workspaceRoot = "/repo";
		const expected = __test__.buildCliConnectCommand(workspaceRoot, []);

		configureConnectorCliLaunch(workspaceRoot);

		expect(readConnectorCliLaunchSpec()).toEqual({
			launcher: expected.launcher,
			connectArgsPrefix: expected.childArgs,
			cwd: workspaceRoot,
		});
	});

	it("uses the atomic restart command for an active channel", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], true),
		).toEqual(["--restart", "telegram", "-k", "token"]);
	});

	it("starts an inactive channel directly", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], false),
		).toEqual(["telegram", "-k", "token"]);
	});

	it("rejects a channel-wide restart when multiple instances are active", () => {
		expect(() => __test__.shouldRestartConnector("telegram", 2)).toThrow(
			"cannot safely restart telegram: 2 instances are active",
		);
	});
});
