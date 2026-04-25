import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHubUrl } from "./connect";

const envSnapshot = {
	CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	CLINE_BUILD_ENV: process.env.CLINE_BUILD_ENV,
};

beforeEach(() => {
	// Pin to production so default port assertions are deterministic regardless
	// of the ambient build env (e.g. when vitest sets CLINE_BUILD_ENV=development).
	process.env.CLINE_BUILD_ENV = "production";
});

afterEach(() => {
	process.env.CLINE_HUB_DISCOVERY_PATH = envSnapshot.CLINE_HUB_DISCOVERY_PATH;
	process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
	if (envSnapshot.CLINE_BUILD_ENV === undefined) {
		delete process.env.CLINE_BUILD_ENV;
	} else {
		process.env.CLINE_BUILD_ENV = envSnapshot.CLINE_BUILD_ENV;
	}
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("resolveHubUrl", () => {
	it("prefers discovered hub URL when no explicit endpoint is provided", async () => {
		const discoveryPath = "/tmp/test-hub-discovery.json";
		process.env.CLINE_HUB_DISCOVERY_PATH = discoveryPath;
		vi.spyOn(await import("./discovery"), "readHubDiscovery").mockResolvedValue(
			{
				hubId: "hub-test",
				protocolVersion: "v1",
				host: "127.0.0.1",
				port: 25463,
				url: "ws://127.0.0.1:25463/hub",
				startedAt: new Date(0).toISOString(),
				updatedAt: new Date(0).toISOString(),
			},
		);

		await expect(resolveHubUrl()).resolves.toBe("ws://127.0.0.1:25463/hub");
	});

	it("falls back to the default endpoint when no discovery file exists", async () => {
		process.env.CLINE_HUB_DISCOVERY_PATH = "/tmp/missing-hub-discovery.json";
		vi.spyOn(await import("./discovery"), "readHubDiscovery").mockResolvedValue(
			undefined,
		);

		await expect(resolveHubUrl()).resolves.toBe("ws://127.0.0.1:25463/hub");
	});

	it("uses an explicit endpoint without consulting discovery", async () => {
		const readHubDiscovery = vi.spyOn(
			await import("./discovery"),
			"readHubDiscovery",
		);

		await expect(
			resolveHubUrl({
				host: "0.0.0.0",
				port: 9321,
				pathname: "/custom",
			}),
		).resolves.toBe("ws://0.0.0.0:9321/custom");
		expect(readHubDiscovery).not.toHaveBeenCalled();
	});
});
