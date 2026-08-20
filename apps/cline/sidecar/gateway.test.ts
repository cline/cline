import { describe, expect, it } from "vitest";
import { KNOWN_GATEWAY_CAPABILITIES } from "@cline/shared/gateway";
import {
	gatewaySpawnCwd,
	missingDesktopGatewayCapabilities,
} from "./gateway";

describe("gatewaySpawnCwd", () => {
	it("advertises explicit session creation for desktop version negotiation", () => {
		expect(KNOWN_GATEWAY_CAPABILITIES).toContain("sessions.create");
	});

	it("requires an explicit update when the running Gateway is too old", () => {
		expect(
			missingDesktopGatewayCapabilities({
				hello: { capabilities: ["runs.async"] },
			} as never),
		).toEqual([
			"sessions.create",
			"connectors.authorization",
			"connectors.slackLoadingStatus",
			"connectors.slackMentionGate",
		]);
	});
	it("uses the real executable directory for a compiled sidecar", () => {
		expect(
			gatewaySpawnCwd(
				true,
				"/Applications/Cline Bots.app/Contents/MacOS/cline-sidecar",
				"/$bunfs/root",
			),
		).toBe("/Applications/Cline Bots.app/Contents/MacOS");
	});

	it("uses the source app directory during development", () => {
		expect(
			gatewaySpawnCwd(false, "/usr/local/bin/bun", "/repo/apps/cline/sidecar"),
		).toBe("/repo/apps/cline");
	});
});
