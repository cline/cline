import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildCliSubcommandCommand,
	resolveCliLaunchSpec,
} from "./internal-launch";

describe("internal launch helpers", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("resolves the source entrypoint when running from TypeScript", () => {
		const entryPath = fileURLToPath(import.meta.url);
		const spec = resolveCliLaunchSpec({
			execPath: "/Users/test/.bun/bin/bun",
			argv: ["bun", entryPath],
			execArgv: ["--conditions=development"],
			cwd: dirname(entryPath),
			env: {},
		});

		expect(spec).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgsPrefix: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				"--conditions=development",
				entryPath,
			],
			identityPath: entryPath,
			mode: "source",
		});
	});

	it("falls back to launching the compiled binary directly for bunfs argv", () => {
		const command = buildCliSubcommandCommand("hub", ["start"], {
			execPath: "/tmp/cline",
			argv: ["bun", "/$bunfs/root/cline", "hey"],
			execArgv: [],
			cwd: "/tmp",
		});

		expect(command).toEqual({
			launcher: "/tmp/cline",
			childArgs: ["hub", "start"],
		});
	});

	it("adds node debug flags for development node launches", () => {
		const entryPath = fileURLToPath(import.meta.url);
		const command = buildCliSubcommandCommand("hub", ["start"], {
			execPath: "/usr/local/bin/node",
			argv: ["node", entryPath],
			execArgv: [],
			cwd: dirname(entryPath),
			env: { CLINE_BUILD_ENV: "development" },
		});

		expect(command).toEqual({
			launcher: "/usr/local/bin/node",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				entryPath,
				"hub",
				"start",
			],
		});
	});
});
