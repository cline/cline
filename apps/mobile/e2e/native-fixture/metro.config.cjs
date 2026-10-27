/** Opt-in bundle resolver: not referenced by the shipping Metro configuration. */
const path = require("node:path");
if (process.env.CLINE_NATIVE_FIXTURE_BUILD !== "1") {
	throw new Error(
		"Native fixture Metro config requires CLINE_NATIVE_FIXTURE_BUILD=1.",
	);
}
const config = require("../../metro.config.js");
const fixtureEnv = path.resolve(__dirname, "fixture-env.ts");
const shippingEnv = path.resolve(__dirname, "../../src/config/env.ts");
const original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
	const result = original(context, name, platform);
	if (
		context.originModulePath !== fixtureEnv &&
		result.type === "sourceFile" &&
		result.filePath === shippingEnv
	) {
		return { type: "sourceFile", filePath: fixtureEnv };
	}
	return result;
};
config.cacheVersion = `isolated-native-fixture-${process.env.EXPO_PUBLIC_NATIVE_FIXTURE_BASE || "http://127.0.0.1:4783"}`;
module.exports = config;
