import { describe, expect, it } from "vitest";
import { gatewaySpawnCwd } from "./gateway";

describe("gatewaySpawnCwd", () => {
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
