import { CLINE_BUILD_ENV_ENV } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveDefaultHubOwnerContext,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "./workspace";

type EnvSnapshot = {
	CLINE_BUILD_ENV: string | undefined;
	CLINE_DATA_DIR: string | undefined;
	CLINE_HUB_DISCOVERY_PATH: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_BUILD_ENV: process.env[CLINE_BUILD_ENV_ENV],
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_HUB_DISCOVERY_PATH: process.env.CLINE_HUB_DISCOVERY_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	if (snapshot.CLINE_BUILD_ENV === undefined) {
		delete process.env[CLINE_BUILD_ENV_ENV];
	} else {
		process.env[CLINE_BUILD_ENV_ENV] = snapshot.CLINE_BUILD_ENV;
	}
	if (snapshot.CLINE_DATA_DIR === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	}
	if (snapshot.CLINE_HUB_DISCOVERY_PATH === undefined) {
		delete process.env.CLINE_HUB_DISCOVERY_PATH;
	} else {
		process.env.CLINE_HUB_DISCOVERY_PATH = snapshot.CLINE_HUB_DISCOVERY_PATH;
	}
}

describe("resolveDefaultHubOwnerContext", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses the production singleton owner in production builds", () => {
		snapshot = captureEnv();
		process.env[CLINE_BUILD_ENV_ENV] = "production";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		delete process.env.CLINE_HUB_DISCOVERY_PATH;

		expect(resolveDefaultHubOwnerContext()).toEqual(
			resolveProductionHubOwnerContext(),
		);
	});

	it("uses the shared owner in development builds", () => {
		snapshot = captureEnv();
		process.env[CLINE_BUILD_ENV_ENV] = "development";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		delete process.env.CLINE_HUB_DISCOVERY_PATH;

		expect(resolveDefaultHubOwnerContext()).toEqual(
			resolveSharedHubOwnerContext(),
		);
	});
});
