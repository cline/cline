import { describe, expect, it } from "vitest";
import {
	BEDROCK_CODER_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
} from "./hub-daemon-env";

describe("hub daemon environment helpers", () => {
	it("detects hub daemon mode from the shared sentinel", () => {
		expect(
			isHubDaemonProcess({
				[BEDROCK_CODER_RUN_AS_HUB_DAEMON_ENV]: "1",
			}),
		).toBe(true);
		expect(
			isHubDaemonProcess({
				[BEDROCK_CODER_RUN_AS_HUB_DAEMON_ENV]: "0",
			}),
		).toBe(false);
	});
});
