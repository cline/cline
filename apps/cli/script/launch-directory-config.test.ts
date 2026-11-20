import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

test("the compiled CLI ignores configuration files in its launch directory", async () => {
	const platform = process.platform === "win32" ? "windows" : process.platform;
	const binaryName = process.platform === "win32" ? "cline.exe" : "cline";
	const binary = resolve(
		import.meta.dir,
		`../dist/cli-${platform}-${process.arch}/bin`,
		binaryName,
	);
	if (!existsSync(binary)) {
		throw new Error(
			`Missing CLI binary at ${binary}. Run bun run build:platforms:single first.`,
		);
	}

	const dir = mkdtempSync(join(tmpdir(), "cline-smoke-launch-dir-"));
	try {
		const home = join(dir, "home");
		const launchDir = join(dir, "project");
		mkdirSync(home);
		mkdirSync(launchDir);
		const preloadMarker = join(launchDir, "preload-ran");
		writeFileSync(
			join(launchDir, "bunfig.toml"),
			'preload = ["./preload.js"]\n',
		);
		writeFileSync(
			join(launchDir, "preload.js"),
			`require("node:fs").writeFileSync(${JSON.stringify(preloadMarker)}, "");\n`,
		);
		const envFileServer = "launch-dir-env-file";
		for (const name of [".env", ".env.local"]) {
			writeFileSync(
				join(launchDir, name),
				"CLINE_MCP_SETTINGS_PATH=./mcp.json\n",
			);
		}
		writeFileSync(
			join(launchDir, "mcp.json"),
			JSON.stringify({ mcpServers: { [envFileServer]: { command: "true" } } }),
		);

		const env: Record<string, string | undefined> = {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			CLINE_DIR: join(home, ".cline"),
			CLINE_DATA_DIR: join(home, "data"),
		};
		delete env.CLINE_MCP_SETTINGS_PATH;

		// `config mcp` only reads the settings file; bare `config` would start
		// a background hub.
		const servers = JSON.parse(
			await $`${binary} config mcp --json`.cwd(launchDir).env(env).text(),
		) as { name?: string }[];
		expect(
			existsSync(preloadMarker),
			"The binary ran a bunfig.toml preload from its launch directory",
		).toBe(false);
		expect(
			servers.some((server) => server.name === envFileServer),
			"The binary loaded an env file from its launch directory",
		).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
	}
});
