import { resolve } from "node:path";
import { HUB_VERSION } from "@cline/hub";
import { describe, expect, it } from "vitest";
import { resolveDesktopHubDaemonLaunchSpec } from "./hub-launch";

describe("desktop Hub launch", () => {
	it("uses the sibling code-hub executable in a packaged app", () => {
		expect(
			resolveDesktopHubDaemonLaunchSpec({
				execPath: "/Applications/Cline.app/Contents/MacOS/code-sidecar",
				argv: ["code-sidecar", "/$bunfs/root/entry.js"],
				cwd: "/workspace",
				platform: "darwin",
			}),
		).toEqual({
			launcher: "/Applications/Cline.app/Contents/MacOS/code-hub",
			argsPrefix: [],
			cwd: "/workspace",
			version: HUB_VERSION,
		});
	});

	it("uses the standalone daemon source entry during development", () => {
		const repoRoot = resolve(import.meta.dirname, "../../../..");
		expect(
			resolveDesktopHubDaemonLaunchSpec({
				execPath: "/usr/local/bin/bun",
				argv: [
					"bun",
					resolve(repoRoot, "apps/examples/desktop-app/sidecar/index.ts"),
				],
				execArgv: ["--conditions=development"],
				cwd: repoRoot,
			}),
		).toEqual({
			launcher: "/usr/local/bin/bun",
			argsPrefix: [
				"--conditions=development",
				resolve(repoRoot, "sdk/packages/hub-daemon/src/entry.ts"),
			],
			cwd: repoRoot,
			version: HUB_VERSION,
		});
	});
});
