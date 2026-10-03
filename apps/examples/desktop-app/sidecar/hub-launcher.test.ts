import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configureHubLauncher, resolveBundledCliBinary } from "./hub-launcher";

const CLI_NAME = process.platform === "win32" ? "cline.exe" : "cline";

it("prefers an explicitly configured launcher over any bundled copy", () => {
	expect(
		resolveBundledCliBinary({
			env: { CLINE_HUB_LAUNCHER_BINARY: "/opt/cline/cline" },
			exists: () => true,
		}),
	).toBe("/opt/cline/cline");
});

it("finds the CLI packaged beside the app executable", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-launcher-"));
	try {
		const binDir = join(root, "bin");
		mkdirSync(binDir, { recursive: true });
		const cli = join(binDir, CLI_NAME);
		writeFileSync(cli, "cli");
		expect(
			resolveBundledCliBinary({
				execPath: join(binDir, "code-sidecar"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(cli);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("finds the CLI in the macOS bundle Resources layout", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-launcher-"));
	try {
		const contents = join(root, "Cline.app", "Contents");
		const resources = join(contents, "Resources", "bin");
		mkdirSync(resources, { recursive: true });
		mkdirSync(join(contents, "MacOS"), { recursive: true });
		const cli = join(resources, CLI_NAME);
		writeFileSync(cli, "cli");
		expect(
			resolveBundledCliBinary({
				execPath: join(contents, "MacOS", "code-sidecar"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(cli);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("publishes the resolved CLI so spawned hubs inherit it", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-launcher-"));
	try {
		const binDir = join(root, "bin");
		mkdirSync(binDir, { recursive: true });
		const cli = join(binDir, CLI_NAME);
		writeFileSync(cli, "cli");
		const env: NodeJS.ProcessEnv = {};
		expect(
			configureHubLauncher({
				execPath: join(binDir, "code-sidecar"),
				cwd: tmpdir(),
				env,
			}),
		).toBe(cli);
		expect(env.CLINE_HUB_LAUNCHER_BINARY).toBe(cli);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("leaves the launcher unset when no CLI is bundled, so core falls back", () => {
	const env: NodeJS.ProcessEnv = {};
	expect(
		configureHubLauncher({
			execPath: join(tmpdir(), "nonexistent", "code-sidecar"),
			cwd: join(tmpdir(), "nonexistent"),
			env,
		}),
	).toBeUndefined();
	expect(env.CLINE_HUB_LAUNCHER_BINARY).toBeUndefined();
});
