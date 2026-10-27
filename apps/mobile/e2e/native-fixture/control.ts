#!/usr/bin/env bun
import { readFileSync } from "node:fs";

const configPath = process.env.FIXTURE_CONFIG_PATH;
if (!configPath)
	throw new Error(
		"Set FIXTURE_CONFIG_PATH to the running fixture state directory config.json.",
	);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const action = process.argv[2];
if (
	![
		"archive",
		"resume",
		"release",
		"history-error",
		"hydrate-error",
		"abort-error",
		"events",
	].includes(action)
)
	throw new Error(
		"Use archive | resume | release | history-error | hydrate-error | abort-error | events [0|1]",
	);
const response = await fetch(
	`${config.base}/control/${action}?enabled=${process.argv[3] || "1"}`,
	{ headers: { "x-fixture-key": config.controlKey } },
);
if (!response.ok) throw new Error(`Control failed: ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
