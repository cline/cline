import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;
const mcpWizard = vi.hoisted(() => vi.fn(async () => 0));
let importDataDir: string | undefined;

vi.mock("./commands/update", () => ({ autoUpdateOnStartup: vi.fn() }));
vi.mock("./utils/telemetry", () => ({ captureCliExtensionActivated: vi.fn() }));
vi.mock("./utils/feature-flags", () => ({}));
vi.mock("./utils/provider-auth", () => ({}));
vi.mock("./wizards/mcp", () => ({ runMcpWizard: mcpWizard }));

describe("MCP install data directory", () => {
	let root: string;
	let defaultPath: string;
	let savedEnv: NodeJS.ProcessEnv;
	const sentinel = '{"mcpServers":{},"sentinel":"unchanged"}\n';

	beforeEach(() => {
		process.exitCode = undefined;
		mcpWizard.mockReset();
		mcpWizard.mockResolvedValue(0);
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			configurable: true,
		});
		savedEnv = { ...process.env };
		root = mkdtempSync(join(tmpdir(), "cline-mcp-dispatch-"));
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("CLINE_")) delete process.env[key];
		}
		process.env.HOME = join(root, "home");
		process.env.USERPROFILE = process.env.HOME;
		process.env.CLINE_NO_AUTO_UPDATE = "1";
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(root, "global.json");
		defaultPath = join(
			process.env.HOME,
			".cline/data/settings/cline_mcp_settings.json",
		);
		mkdirSync(dirname(defaultPath), { recursive: true });
		writeFileSync(defaultPath, sentinel);
		importDataDir = undefined;
		vi.resetModules();
		vi.doMock("./commands/mcp", async (importOriginal) => {
			importDataDir = process.env.CLINE_DATA_DIR;
			return importOriginal<typeof import("./commands/mcp")>();
		});
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) delete process.env[key];
		}
		Object.assign(process.env, savedEnv);
		rmSync(root, { recursive: true, force: true });
		process.argv = originalArgv;
		process.exitCode = originalExitCode;
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalStdinIsTTY,
			configurable: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalStdoutIsTTY,
			configurable: true,
		});
		vi.doUnmock("./commands/mcp");
		vi.restoreAllMocks();
		vi.resetModules();
	});

	async function dispatch(args: string[]) {
		process.argv = ["bun", "src/index.ts", ...args];
		const { runCli } = await import("./main");
		await runCli();
	}

	function expectDefaultUntouched() {
		expect(readFileSync(defaultPath, "utf8")).toBe(sentinel);
		expect(readdirSync(join(root, "home"), { recursive: true }).sort()).toEqual(
			[
				".cline",
				join(".cline", "data"),
				join(".cline", "data", "settings"),
				join(".cline", "data", "settings", "cline_mcp_settings.json"),
			],
		);
	}

	it.each([
		"install",
		"add",
	])("initializes before importing %s and opening the wizard", async (command) => {
		const dataDir = join(root, "isolated data");
		mcpWizard.mockImplementation(async () => {
			const { resolveMcpSettingsPath } = await import("@cline/shared/storage");
			expect(resolveMcpSettingsPath()).toBe(
				join(dataDir, "settings/cline_mcp_settings.json"),
			);
			return 0;
		});
		await dispatch([
			"--data-dir",
			dataDir,
			"mcp",
			command,
			"sample",
			"--",
			"node",
			"unused.js",
		]);
		expect(importDataDir).toBe(dataDir);
		expect(mcpWizard).toHaveBeenCalled();
		expect(process.exitCode).toBe(0);
		expectDefaultUntouched();
	});

	it.each([
		"explicit",
		"equals",
		"previous env",
		"override",
		"sandbox",
		"relative",
		"existing env",
		"default",
	])("persists --yes through real storage: %s", async (scenario) => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			value: false,
			configurable: true,
		});
		const dataDir = join(root, "isolated data");
		let expected = join(dataDir, "settings/cline_mcp_settings.json");
		let args = ["--data-dir", dataDir];
		if (scenario === "equals") args = [`--data-dir=${dataDir}`];
		if (scenario === "previous env")
			process.env.CLINE_DATA_DIR = join(root, "old data");
		if (scenario === "override") {
			expected = join(root, "override", "mcp.json");
			process.env.CLINE_MCP_SETTINGS_PATH = expected;
		}
		if (scenario === "sandbox") {
			args = [];
			process.env.CLINE_SANDBOX = "1";
			process.env.CLINE_SANDBOX_DATA_DIR = dataDir;
		}
		if (scenario === "relative")
			args = ["--cwd", root, "--data-dir", "isolated data"];
		if (scenario === "existing env") {
			args = [];
			process.env.CLINE_DATA_DIR = dataDir;
		}
		if (scenario === "default") {
			args = [];
			expected = defaultPath;
		}
		await dispatch([
			...args,
			"mcp",
			"install",
			"sample",
			"--yes",
			"--json",
			"--",
			"node",
			"unused.js",
		]);
		expect(process.exitCode).toBe(0);
		expect(
			JSON.parse(readFileSync(expected, "utf8")).mcpServers.sample.transport,
		).toEqual({
			type: "stdio",
			command: "node",
			args: ["unused.js"],
		});
		if (scenario !== "default") expectDefaultUntouched();
		if (scenario === "override") expect(existsSync(dataDir)).toBe(false);
		if (scenario === "previous env")
			expect(existsSync(join(root, "old data"))).toBe(false);
		if (scenario === "existing env" || scenario === "default")
			expect(process.env.CLINE_SANDBOX).toBeUndefined();
	});

	it.each([
		"no TTY",
		"invalid transport",
	])("preserves errors without writing settings: %s", async (scenario) => {
		const dataDir = join(root, "isolated data");
		if (scenario === "no TTY")
			Object.defineProperty(process.stdin, "isTTY", {
				value: false,
				configurable: true,
			});
		const options =
			scenario === "invalid transport"
				? ["--yes", "--transport", "invalid"]
				: [];
		await dispatch([
			"--data-dir",
			dataDir,
			"mcp",
			"install",
			"sample",
			...options,
			"--",
			"node",
			"unused.js",
		]);
		expect(process.exitCode).toBe(1);
		expect(existsSync(dataDir)).toBe(false);
		expectDefaultUntouched();
	});
});
