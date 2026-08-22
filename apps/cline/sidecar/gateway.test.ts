import { KNOWN_GATEWAY_CAPABILITIES } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	DESKTOP_GATEWAY_NAMESPACE,
	gatewayLifecycleInvocation,
	gatewaySpawnCwd,
	missingDesktopGatewayCapabilities,
} from "./gateway";
import { resolveSidecarPort } from "./types";

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
			"sessions.dedicated",
			"sessions.fork",
			"runs.queuedMutations",
			"bots.profilePromptLayers",
			"providers.settings",
			"providers.oauth",
			"account.cline",
			"settings.global",
			"voice.transcription",
			"marketplace.management",
			"mcp.settings",
			"plugins.management",
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

	it("invokes only the bundled Gateway lifecycle binary in compiled builds", () => {
		expect(
			gatewayLifecycleInvocation(
				"start",
				"/Applications/Cline Bots.app/Contents/MacOS/cline-sidecar",
				"/$bunfs/root",
			),
		).toEqual({
			executable: "/Applications/Cline Bots.app/Contents/MacOS/clinegate",
			args: [
				"start",
				"--namespace",
				DESKTOP_GATEWAY_NAMESPACE,
				"--lead-profile",
				"cline-dad",
			],
			cwd: "/Applications/Cline Bots.app/Contents/MacOS",
		});
	});

	it("invokes only this repository's Gateway lifecycle entry in source builds", () => {
		expect(
			gatewayLifecycleInvocation(
				"upgrade",
				"/usr/local/bin/bun",
				"/repo/apps/cline/sidecar",
			),
		).toEqual({
			executable: "/usr/local/bin/bun",
			args: [
				"/repo/sdk/packages/gateway/bin/clinegate.mjs",
				"upgrade",
				"--namespace",
				DESKTOP_GATEWAY_NAMESPACE,
				"--lead-profile",
				"cline-dad",
			],
			cwd: "/repo/apps/cline",
		});
	});

	it("preserves port zero for native per-workspace sidecars", () => {
		expect(resolveSidecarPort("0")).toBe(0);
		expect(resolveSidecarPort(undefined)).toBe(3126);
		expect(() => resolveSidecarPort("not-a-port")).toThrow(
			"Invalid CLINE_SIDECAR_PORT",
		);
	});
});
