import { describe, expect, it } from "vitest";
import {
	augmentNodeCommandForDebug,
	BEDROCK_CODER_BUILD_ENV_ENV,
	BEDROCK_CODER_DEBUG_HOST_ENV,
	BEDROCK_CODER_DEBUG_PORT_BASE_ENV,
	resolveBedrockCoderBuildEnv,
	withResolvedBedrockCoderBuildEnv,
} from "./build-env";

describe("build env helpers", () => {
	it("prefers explicit BEDROCK_CODER_BUILD_ENV", () => {
		expect(
			resolveBedrockCoderBuildEnv({
				env: { [BEDROCK_CODER_BUILD_ENV_ENV]: "development", NODE_ENV: "production" },
			}),
		).toBe("development");
	});

	it("treats development conditions as a development build", () => {
		expect(
			resolveBedrockCoderBuildEnv({
				env: {},
				execArgv: ["--conditions=development"],
			}),
		).toBe("development");
	});

	it("defaults to production otherwise", () => {
		expect(resolveBedrockCoderBuildEnv({ env: {}, execArgv: [] })).toBe("production");
	});

	it("treats NODE_ENV=development as a development build", () => {
		expect(
			resolveBedrockCoderBuildEnv({ env: { NODE_ENV: "development" }, execArgv: [] }),
		).toBe("development");
	});

	it("does not treat NODE_ENV=test as a development build", () => {
		expect(
			resolveBedrockCoderBuildEnv({ env: { NODE_ENV: "test" }, execArgv: [] }),
		).toBe("production");
	});

	it("does not treat NODE_ENV=staging as a development build", () => {
		expect(
			resolveBedrockCoderBuildEnv({ env: { NODE_ENV: "staging" }, execArgv: [] }),
		).toBe("production");
	});

	it("materializes BEDROCK_CODER_BUILD_ENV when absent", () => {
		expect(
			withResolvedBedrockCoderBuildEnv({ NODE_ENV: "development" }, { execArgv: [] })[
				BEDROCK_CODER_BUILD_ENV_ENV
			],
		).toBe("development");
	});

	it("adds dynamic inspect and source maps for node commands in development", () => {
		expect(
			augmentNodeCommandForDebug(["node", "script.js"], {
				env: { [BEDROCK_CODER_BUILD_ENV_ENV]: "development" },
				debugRole: "rpc",
			}),
		).toEqual([
			"node",
			"--inspect=127.0.0.1:0",
			"--enable-source-maps",
			"script.js",
		]);
	});

	it("allows overriding the debug host and base port", () => {
		expect(
			augmentNodeCommandForDebug(["node", "script.js"], {
				env: {
					[BEDROCK_CODER_BUILD_ENV_ENV]: "development",
					[BEDROCK_CODER_DEBUG_HOST_ENV]: "0.0.0.0",
					[BEDROCK_CODER_DEBUG_PORT_BASE_ENV]: "9500",
				},
				debugRole: "plugin-sandbox",
			}),
		).toEqual([
			"node",
			"--inspect=0.0.0.0:9502",
			"--enable-source-maps",
			"script.js",
		]);
	});

	it("adds inspect and source maps for bun commands in development", () => {
		expect(
			augmentNodeCommandForDebug(["/usr/local/bin/bun", "script.js"], {
				env: { [BEDROCK_CODER_BUILD_ENV_ENV]: "development" },
				debugRole: "rpc",
			}),
		).toEqual([
			"/usr/local/bin/bun",
			"--inspect=127.0.0.1:0",
			"--enable-source-maps",
			"script.js",
		]);
	});

	it("does not duplicate existing node debug flags", () => {
		expect(
			augmentNodeCommandForDebug(["node", "--inspect=9229", "script.js"], {
				env: {
					[BEDROCK_CODER_BUILD_ENV_ENV]: "development",
					NODE_OPTIONS: "--enable-source-maps",
				},
			}),
		).toEqual(["node", "--inspect=9229", "script.js"]);
	});
});
