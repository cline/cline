import { afterEach, describe, expect, it } from "vitest";
import { resolveSharedHubOwnerContext } from "./workspace";

const envSnapshot = {
	CLINE_BUILD_ENV: process.env.CLINE_BUILD_ENV,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
};

function restoreEnv(): void {
	if (envSnapshot.CLINE_BUILD_ENV === undefined) {
		delete process.env.CLINE_BUILD_ENV;
	} else {
		process.env.CLINE_BUILD_ENV = envSnapshot.CLINE_BUILD_ENV;
	}
	if (envSnapshot.CLINE_DATA_DIR === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
	}
	if (envSnapshot.CLINE_HUB_DISCOVERY_PATH === undefined) {
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
	} else {
		process.env.CLINE_HUB_DISCOVERY_PATH = envSnapshot.CLINE_HUB_DISCOVERY_PATH;
	}
}

describe("resolveSharedHubOwnerContext", () => {
	afterEach(() => {
		restoreEnv();
	});

	it("uses separate discovery owners for production and development hubs", () => {
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		process.env.CLINE_BUILD_ENV = "production";
		const production = resolveSharedHubOwnerContext();

		process.env.CLINE_BUILD_ENV = "development";
		const development = resolveSharedHubOwnerContext();

		expect(development.ownerId).not.toBe(production.ownerId);
		expect(development.discoveryPath).not.toBe(production.discoveryPath);
	});

	it("honors an explicit shared owner label", () => {
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		process.env.CLINE_BUILD_ENV = "development";

		const development = resolveSharedHubOwnerContext("shared:custom");

		process.env.CLINE_BUILD_ENV = "production";
		const production = resolveSharedHubOwnerContext("shared:custom");

		expect(development).toEqual(production);
	});
});
