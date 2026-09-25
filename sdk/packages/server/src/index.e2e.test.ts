import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

it("starts, reuses, and stops only its owned Hub through the Node executable", async () => {
	const directory = await mkdtemp(join(tmpdir(), "cline-server-e2e-"));
	const discovery = join(directory, "hub.json");
	const env = {
		...process.env,
		CLINE_DIR: join(directory, "data"),
		CLINE_TELEMETRY_DISABLED: "1",
	};
	const run = async (...args: string[]) =>
		(await exec("node", [entry, ...args], { env, timeout: 30_000 })).stdout;
	try {
		const first = JSON.parse(
			await run(
				"--remote-hub-ensure",
				"--discovery-path",
				discovery,
				"--cwd",
				directory,
			),
		);
		const firstDiscovery = JSON.parse(await readFile(discovery, "utf8"));
		const second = JSON.parse(
			await run(
				"--remote-hub-ensure",
				"--discovery-path",
				discovery,
				"--cwd",
				directory,
			),
		);
		expect(first.authToken).toEqual(expect.any(String));
		expect(first.authToken.length).toBeGreaterThan(0);
		expect(firstDiscovery.hubId).toBeTruthy();
		expect(JSON.parse(await readFile(discovery, "utf8")).hubId).toBe(
			firstDiscovery.hubId,
		);
		expect(second.url).toBe(first.url);
		expect(second.authToken).toBe(first.authToken);
		expect(new URL(first.url).hostname).toBe("127.0.0.1");
	} finally {
		await run("--remote-hub-stop", "--discovery-path", discovery);
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);
