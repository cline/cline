import { describe, expect, it } from "vitest";
import { createDesktopRuntimeInfo } from "./runtime-info";

describe("createDesktopRuntimeInfo", () => {
	it("builds one canonical app, SDK, runtime, OS, and environment snapshot", () => {
		expect(
			createDesktopRuntimeInfo(
				{ pathChanged: true, pathSource: "shell" },
				{
					appVersion: "1.2.3",
					coreVersion: "4.5.6",
					bunVersion: "1.3.4",
					nodeVersion: "v24.0.0",
					os: {
						platform: "darwin",
						name: "Darwin",
						version: "Darwin Kernel Version 25",
						release: "25.0.0",
						arch: "arm64",
					},
				},
			),
		).toEqual({
			app: { name: "Cline Code", version: "1.2.3" },
			sdk: { coreVersion: "4.5.6" },
			runtime: {
				name: "bun",
				version: "1.3.4",
				nodeVersion: "v24.0.0",
			},
			os: {
				platform: "darwin",
				name: "Darwin",
				version: "Darwin Kernel Version 25",
				release: "25.0.0",
				arch: "arm64",
			},
			environment: { pathSource: "shell", pathChanged: true },
		});
	});
});
