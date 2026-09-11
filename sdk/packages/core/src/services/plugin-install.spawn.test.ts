import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: spawnMock,
	};
});

import { installPlugin } from "./plugin-install";

const INSTALL_ARGS = [
	"install",
	"--omit=dev",
	"--omit=peer",
	"--legacy-peer-deps",
	"--no-audit",
	"--no-fund",
	"--package-lock=false",
] as const;

describe("plugin install npm spawn command", () => {
	let root = "";
	let home = "";
	let workspace = "";
	let source = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;
	let originalMcpSettingsPath: string | undefined;
	let originalNpmCommand: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-plugin-install-spawn-"));
		home = join(root, "home");
		workspace = join(root, "workspace");
		source = join(root, "plugin-package");
		mkdirSync(source, { recursive: true });
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({
				name: "plugin-package",
				type: "module",
				cline: { plugins: [{ paths: ["./index.ts"] }] },
			}),
			"utf8",
		);
		writeFileSync(
			join(source, "index.ts"),
			"export default { name: 'plugin-package', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		originalNpmCommand = process.env.CLINE_NPM_COMMAND;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		process.env.CLINE_MCP_SETTINGS_PATH = join(
			home,
			".cline",
			"cline_mcp_settings.json",
		);
		delete process.env.CLINE_NPM_COMMAND;
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);

		spawnMock.mockReset();
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as EventEmitter & {
				stderr: PassThrough;
			};
			child.stderr = new PassThrough();
			queueMicrotask(() => child.emit("close", 0, null));
			return child as unknown as ChildProcess;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalClineDir === undefined) delete process.env.CLINE_DIR;
		else process.env.CLINE_DIR = originalClineDir;
		if (originalClineDataDir === undefined) delete process.env.CLINE_DATA_DIR;
		else process.env.CLINE_DATA_DIR = originalClineDataDir;
		if (originalMcpSettingsPath === undefined)
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		else process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		if (originalNpmCommand === undefined) delete process.env.CLINE_NPM_COMMAND;
		else process.env.CLINE_NPM_COMMAND = originalNpmCommand;
		rmSync(root, { recursive: true, force: true });
	});

	async function expectSpawnCommand(
		platform: NodeJS.Platform,
		expectedCommand: string,
		npmCommand?: string,
	): Promise<void> {
		vi.spyOn(process, "platform", "get").mockReturnValue(platform);
		await installPlugin({ source, cwd: workspace, npmCommand });

		const npmInstallCalls = spawnMock.mock.calls.filter(
			([, args]) =>
				Array.isArray(args) &&
				args[0] === "install" &&
				args.includes("--package-lock=false"),
		);
		expect(npmInstallCalls).toHaveLength(1);
		const [command, args, options] = npmInstallCalls[0] as [
			string,
			string[],
			SpawnOptions,
		];
		expect(command).toBe(expectedCommand);
		expect(args).toEqual(INSTALL_ARGS);
		expect(options).toMatchObject({
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
		expect(options.shell).not.toBe(true);
	}

	it("spawns npm.cmd with install arguments on Windows", async () => {
		await expectSpawnCommand("win32", "npm.cmd");
	});

	it.each([
		"darwin",
		"linux",
	] as const)("keeps the npm command on %s", async (platform) => {
		await expectSpawnCommand(platform, "npm");
	});

	it("prefers CLINE_NPM_COMMAND over the Windows default", async () => {
		process.env.CLINE_NPM_COMMAND = " env-npm ";
		await expectSpawnCommand("win32", "env-npm");
	});

	it("prefers options.npmCommand over CLINE_NPM_COMMAND", async () => {
		process.env.CLINE_NPM_COMMAND = "env-npm";
		await expectSpawnCommand("win32", "option-npm", "option-npm");
	});
});
