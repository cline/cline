import { CLINE_BUILD_ENV_ENV } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_HUB_PORT,
	resolveDefaultHubPort,
	resolveHubEndpointOptions,
} from "./defaults";

const DEV_HUB_PORT = 25466;

describe("resolveDefaultHubPort", () => {
	it("returns the dev hub port when CLINE_BUILD_ENV is development and CLINE_HUB_PORT is unset", () => {
		expect(
			resolveDefaultHubPort({
				env: { [CLINE_BUILD_ENV_ENV]: "development" },
				execArgv: [],
			}),
		).toBe(DEV_HUB_PORT);
	});

	it("returns the production hub port when CLINE_BUILD_ENV is production and CLINE_HUB_PORT is unset", () => {
		expect(
			resolveDefaultHubPort({
				env: { [CLINE_BUILD_ENV_ENV]: "production" },
				execArgv: [],
			}),
		).toBe(DEFAULT_HUB_PORT);
	});

	it("returns the production hub port when the build env cannot be determined", () => {
		expect(resolveDefaultHubPort({ env: {}, execArgv: [] })).toBe(
			DEFAULT_HUB_PORT,
		);
	});

	it("treats --conditions=development as a development build", () => {
		expect(
			resolveDefaultHubPort({
				env: {},
				execArgv: ["--conditions=development"],
			}),
		).toBe(DEV_HUB_PORT);
	});

	it("honors an explicit CLINE_HUB_PORT override in development", () => {
		expect(
			resolveDefaultHubPort({
				env: {
					[CLINE_BUILD_ENV_ENV]: "development",
					CLINE_HUB_PORT: "31000",
				},
				execArgv: [],
			}),
		).toBe(31000);
	});

	it("honors an explicit CLINE_HUB_PORT override in production", () => {
		expect(
			resolveDefaultHubPort({
				env: {
					[CLINE_BUILD_ENV_ENV]: "production",
					CLINE_HUB_PORT: "31000",
				},
				execArgv: [],
			}),
		).toBe(31000);
	});

	it("falls back to the dev default when CLINE_HUB_PORT is invalid in development", () => {
		expect(
			resolveDefaultHubPort({
				env: {
					[CLINE_BUILD_ENV_ENV]: "development",
					CLINE_HUB_PORT: "not-a-port",
				},
				execArgv: [],
			}),
		).toBe(DEV_HUB_PORT);
	});

	it("falls back to the production default when CLINE_HUB_PORT is invalid in production", () => {
		expect(
			resolveDefaultHubPort({
				env: {
					[CLINE_BUILD_ENV_ENV]: "production",
					CLINE_HUB_PORT: "0",
				},
				execArgv: [],
			}),
		).toBe(DEFAULT_HUB_PORT);
	});
});

describe("resolveHubEndpointOptions", () => {
	it("composes the dev hub port when overrides are not provided in development", () => {
		expect(
			resolveHubEndpointOptions(
				{},
				{
					env: { [CLINE_BUILD_ENV_ENV]: "development" },
					execArgv: [],
				},
			),
		).toEqual({
			host: "127.0.0.1",
			port: DEV_HUB_PORT,
			pathname: "/hub",
		});
	});

	it("respects explicit port overrides regardless of build env", () => {
		expect(
			resolveHubEndpointOptions(
				{ port: 40000 },
				{
					env: { [CLINE_BUILD_ENV_ENV]: "development" },
					execArgv: [],
				},
			).port,
		).toBe(40000);
	});
});
