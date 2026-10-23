import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../", import.meta.url).href);
const transform = `
const { createRequire } = require("node:module");
const babel = createRequire(require.resolve("babel-preset-expo"))("@babel/core");
const result = babel.transformSync("const environment = process.env.EXPO_PUBLIC_ENV;", {
  filename: "release-environment-check.js",
});
process.stdout.write(result.code);
`;

function compileRelease(environment: string | undefined) {
	return spawnSync(process.execPath, ["-e", transform], {
		cwd: mobileRoot,
		env: {
			...process.env,
			NODE_ENV: "production",
			BABEL_ENV: "production",
			EXPO_PUBLIC_ENV: environment,
		},
		encoding: "utf8",
	});
}

describe("release environment", () => {
	it.each([
		undefined,
		"prod",
	])("rejects a release bundle with environment %s", (environment) => {
		const result = compileRelease(environment);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			"Release builds require EXPO_PUBLIC_ENV=production or staging",
		);
	});

	it.each([
		"production",
		"staging",
	])("bundles the explicitly selected %s environment", (environment) => {
		const result = compileRelease(environment);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(JSON.stringify(environment));
		expect(result.stdout).not.toContain("process.env.EXPO_PUBLIC_ENV");
	});
});
