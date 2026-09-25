import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const cliPlatform = process.platform === "win32" ? "windows" : process.platform;
const cliBinaryName = process.platform === "win32" ? "cline.exe" : "cline";
const compiledCli = join(
	root,
	"apps/cli/dist",
	`cli-${cliPlatform}-${process.arch}`,
	"bin",
	cliBinaryName,
);

async function verifyHubLifecycle(
	command: string,
	commandArgs: string[],
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "cline-server-e2e-"));
	const discovery = join(directory, "hub.json");
	const env = {
		...process.env,
		CLINE_DIR: join(directory, "data"),
		CLINE_TELEMETRY_DISABLED: "1",
	};
	const run = async (...args: string[]) =>
		(await exec(command, [...commandArgs, ...args], { env, timeout: 30_000 }))
			.stdout;
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
}

it("starts, reuses, and stops its owned Hub through the Node server entrypoint", async () => {
	await verifyHubLifecycle("node", [entry]);
}, 60_000);

it.runIf(existsSync(compiledCli))(
	"starts, reuses, and stops its owned Hub through the compiled CLI entrypoint",
	async () => {
		await verifyHubLifecycle(compiledCli, []);
	},
	60_000,
);
