import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
describe("CLI remote server commands", () => {
	it("reports server capabilities without starting the interactive CLI", () => {
		const output = execFileSync("bun", [entry, "--remote-hub-info"], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(JSON.parse(output)).toMatchObject({
			remoteHubCommandVersion: 1,
			coreVersion: expect.any(String),
			protocolVersion: expect.any(String),
		});
	});
	it("requires explicit ownership for shutdown", () => {
		const result = spawnSync("bun", [entry, "--remote-hub-stop"], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("--discovery-path is required");
	});
});
