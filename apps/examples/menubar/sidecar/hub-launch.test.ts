import { HUB_VERSION } from "@cline/hub";
import { describe, expect, it } from "vitest";
import { resolveMenubarHubDaemonLaunchSpec } from "./hub-launch";

describe("menubar Hub launch", () => {
	it("uses the sibling menubar-hub executable in a packaged app", () => {
		expect(
			resolveMenubarHubDaemonLaunchSpec({
				execPath:
					"/Applications/Cline Menubar.app/Contents/MacOS/menubar-sidecar",
				argv: ["menubar-sidecar", "/$bunfs/root/entry.js"],
				cwd: "/workspace",
				platform: "darwin",
			}),
		).toEqual({
			launcher: "/Applications/Cline Menubar.app/Contents/MacOS/menubar-hub",
			argsPrefix: [],
			cwd: "/workspace",
			version: HUB_VERSION,
		});
	});
});
