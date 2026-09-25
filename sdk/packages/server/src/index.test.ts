import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { version } from "../package.json";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const run = (...args: string[]) =>
	execFileSync("node", [entry, ...args], { encoding: "utf8", timeout: 15_000 });

describe("published Node executable", () => {
	it("reports the package version", () => {
		expect(run("--version").trim()).toBe(version);
	});
	it("reports the matching SDK release and Hub protocol without starting a Hub", () => {
		expect(JSON.parse(run("--remote-hub-info"))).toMatchObject({
			coreVersion: version,
			remoteHubCommandVersion: 1,
			protocolVersion: expect.any(String),
		});
	});
	it("explains the commands", () => {
		expect(run("--help")).toContain("--discovery-path");
	});
	it.each([
		["invalid"],
		["--remote-hub-ensure"],
		["--remote-hub-stop"],
	])("rejects unsafe or unknown invocation %s", (arg) => {
		const result = spawnSync("node", [entry, arg], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/Unknown command|discovery-path is required/);
	});
});
