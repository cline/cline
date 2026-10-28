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
		"set",
		"clear",
		"state",
		"snapshot",
		"sdk-profile",
		"sdk-release",
	].includes(action)
)
	throw new Error(
		"Use set FAULT VALUE | clear | state | snapshot | archive | resume | release | history-error | hydrate-error | abort-error | events [0|1]. Set FIXTURE_WORKSPACE_ID to scope to one workspace.",
	);
const query = new URLSearchParams();
if (action === "set") {
	query.set("fault", process.argv[3] || "");
	query.set("value", process.argv[4] || "1");
} else query.set("enabled", process.argv[3] || "1");
const workspaceId = process.env.FIXTURE_WORKSPACE_ID;
if (workspaceId) query.set("id", workspaceId);
const response = await fetch(`${config.base}/control/${action}?${query}`, {
	headers: { "x-fixture-key": config.controlKey },
});
if (!response.ok)
	throw new Error(
		`Control failed: ${response.status}: ${await response.text()}`,
	);
console.log(JSON.stringify(await response.json(), null, 2));
