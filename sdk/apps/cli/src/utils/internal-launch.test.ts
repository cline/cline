import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildCliSubcommandCommand,
	buildInternalCliEnv,
	CLINE_INTERNAL_DEPTH_ENV,
	CLINE_INTERNAL_ROLE_ENV,
	getInternalLaunchViolation,
	resolveCliLaunchSpec,
} from "./internal-launch";

describe("internal launch helpers", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("resolves the source entrypoint when running from TypeScript", () => {
		const utilsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(utilsDir, "../../../../");
		const spec = resolveCliLaunchSpec({
			execPath: "/Users/test/.bun/bin/bun",
			argv: ["bun", "./apps/cli/src/index.ts"],
			execArgv: ["--conditions=development"],
			cwd: repoRoot,
		});

		expect(spec).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgsPrefix: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				"--conditions=development",
				resolve(repoRoot, "apps/cli/src/index.ts"),
			],
			identityPath: resolve(repoRoot, "apps/cli/src/index.ts"),
			mode: "source",
		});
	});

	it("falls back to launching the compiled binary directly for bunfs argv", () => {
		const command = buildCliSubcommandCommand("hook-worker", [], {
			execPath: "/tmp/cline",
			argv: ["bun", "/$bunfs/root/cline", "hey"],
			execArgv: [],
			cwd: "/tmp",
		});

		expect(command).toEqual({
			launcher: "/tmp/cline",
			childArgs: ["hook-worker"],
		});
	});

	it("adds node debug flags for development node launches", () => {
		const utilsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(utilsDir, "../../../../");
		const command = buildCliSubcommandCommand("hook-worker", [], {
			execPath: "/usr/local/bin/node",
			argv: ["node", "./apps/cli/src/index.ts"],
			execArgv: [],
			cwd: repoRoot,
			env: { CLINE_BUILD_ENV: "development" },
		});

		expect(command).toEqual({
			launcher: "/usr/local/bin/node",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				resolve(repoRoot, "apps/cli/src/index.ts"),
				"hook-worker",
			],
		});
	});

	it("rejects internal launches when the expected subcommand is missing", () => {
		const env = buildInternalCliEnv("hook-worker", {});

		expect(
			getInternalLaunchViolation(["/$bunfs/root/cline", "hook-worker"], env),
		).toContain('expected subcommand "hook-worker"');
		expect(getInternalLaunchViolation(["hook-worker"], env)).toBeUndefined();
	});

	it("rejects nested internal launches beyond depth one", () => {
		const env = {
			[CLINE_INTERNAL_ROLE_ENV]: "hook-worker",
			[CLINE_INTERNAL_DEPTH_ENV]: "2",
		};

		expect(getInternalLaunchViolation(["hook-worker"], env)).toContain(
			"refusing nested internal CLI launch",
		);
	});
});
