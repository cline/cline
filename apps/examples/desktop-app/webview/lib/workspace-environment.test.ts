import { describe, expect, it } from "vitest";
import { remoteWorkspaceEnvironmentFromContext } from "./workspace-environment";

describe("remoteWorkspaceEnvironmentFromContext", () => {
	it("returns the active SSH environment and its reported home", () => {
		expect(
			remoteWorkspaceEnvironmentFromContext({
				environmentId: "pi-host",
				workspaceRoot: "/home/pi",
				cwd: "/home/pi",
				homeDir: "/home/pi",
				activeEnvironmentId: "pi-host",
				remoteEnvironment: { id: "pi-host", host: "pi.local" },
			}),
		).toEqual({ id: "pi-host", homeDir: "/home/pi" });
	});

	it("keeps local contexts local", () => {
		expect(
			remoteWorkspaceEnvironmentFromContext({
				environmentId: "local",
				workspaceRoot: "/Users/dev/project",
				cwd: "/Users/dev/project",
				homeDir: "/Users/dev",
				activeEnvironmentId: "local",
				remoteEnvironment: null,
			}),
		).toBeNull();
	});
});
