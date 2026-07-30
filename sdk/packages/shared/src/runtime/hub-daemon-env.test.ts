import { describe, expect, it } from "vitest";
import {
	CLINE_CONNECTOR_CLI_LAUNCH_ENV,
	CLINE_CONNECTOR_STARTING_INSTANCE_ENV,
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
	readConnectorCliLaunchSpec,
	readStartingConnectorInstance,
	setConnectorCliLaunchSpec,
	setStartingConnectorInstance,
} from "./hub-daemon-env";

describe("hub daemon environment helpers", () => {
	it("detects hub daemon mode from the shared sentinel", () => {
		expect(
			isHubDaemonProcess({
				[CLINE_RUN_AS_HUB_DAEMON_ENV]: "1",
			}),
		).toBe(true);
		expect(
			isHubDaemonProcess({
				[CLINE_RUN_AS_HUB_DAEMON_ENV]: "0",
			}),
		).toBe(false);
	});

	it("round-trips a connector CLI launch specification", () => {
		const env: Record<string, string | undefined> = {};
		const spec = {
			launcher: "/usr/local/bin/bun",
			connectArgsPrefix: ["/repo/apps/cli/src/index.ts", "connect"],
			cwd: "/workspace",
		};

		setConnectorCliLaunchSpec(spec, env);

		expect(readConnectorCliLaunchSpec(env)).toEqual(spec);
		expect(env[CLINE_CONNECTOR_CLI_LAUNCH_ENV]).toBe(JSON.stringify(spec));
	});

	it("round-trips the connector instance that is starting", () => {
		const env: Record<string, string | undefined> = {};
		const ref = { channel: "slack", instanceId: "cline-slack" };

		setStartingConnectorInstance(ref, env);

		expect(readStartingConnectorInstance(env)).toEqual(ref);
		expect(env[CLINE_CONNECTOR_STARTING_INSTANCE_ENV]).toBe(
			JSON.stringify(ref),
		);
	});

	it("reports no starting connector instance when the marker is absent or malformed", () => {
		expect(readStartingConnectorInstance({})).toBeUndefined();
		expect(
			readStartingConnectorInstance({
				[CLINE_CONNECTOR_STARTING_INSTANCE_ENV]: "not json",
			}),
		).toBeUndefined();
		expect(
			readStartingConnectorInstance({
				[CLINE_CONNECTOR_STARTING_INSTANCE_ENV]: JSON.stringify({
					channel: "slack",
					instanceId: "   ",
				}),
			}),
		).toBeUndefined();
	});

	it("rejects malformed connector CLI launch specifications", () => {
		expect(
			readConnectorCliLaunchSpec({
				[CLINE_CONNECTOR_CLI_LAUNCH_ENV]: JSON.stringify({
					launcher: "bun",
					connectArgsPrefix: [42],
					cwd: "/workspace",
				}),
			}),
		).toBeUndefined();
	});
});
