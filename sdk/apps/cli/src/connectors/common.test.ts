import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { __test__ } from "./common";

describe("spawnDetachedConnector", () => {
	it("preserves the connect subcommand when building detached connector args", () => {
		expect(
			__test__.buildDetachedConnectorArgs(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
			),
		).toEqual([
			"connect",
			"telegram",
			"-m",
			"ClineAdapterBot",
			"-k",
			"token-123",
			"-i",
		]);
	});

	it("preserves bun conditions and resolves the cli entrypoint for detached launches", () => {
		const connectorsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(connectorsDir, "../../../../");
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
				"/Users/test/.bun/bin/bun",
				"./apps/cli/src/index.ts",
				["--conditions=development"],
				repoRoot,
				{},
			),
		).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				"--conditions=development",
				resolve(repoRoot, "apps/cli/src/index.ts"),
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-k",
				"token-123",
				"-i",
			],
		});
	});

	it("uses a dynamic connector inspector port for development node launches", () => {
		const connectorsDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(connectorsDir, "../../../../");
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot"],
				"/usr/local/bin/node",
				"./apps/cli/src/index.ts",
				[],
				repoRoot,
				{ CLINE_BUILD_ENV: "development" },
			),
		).toEqual({
			launcher: "/usr/local/bin/node",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				resolve(repoRoot, "apps/cli/src/index.ts"),
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-i",
			],
		});
	});
});
