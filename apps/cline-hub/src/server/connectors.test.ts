import {
	CLINE_CONNECTOR_CLI_LAUNCH_ENV,
	readConnectorCliLaunchSpec,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { __test__, configureConnectorCliLaunch } from "./connectors";

describe("connector launch command", () => {
	const originalLaunchSpec = process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV];

	afterEach(() => {
		if (originalLaunchSpec === undefined) {
			delete process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV];
		} else {
			process.env[CLINE_CONNECTOR_CLI_LAUNCH_ENV] = originalLaunchSpec;
		}
	});

	it("registers the CLI connect command for the detached daemon", () => {
		const expected = __test__.buildCliConnectCommand([]);

		configureConnectorCliLaunch();

		expect(readConnectorCliLaunchSpec()).toEqual({
			launcher: expected.launcher,
			connectArgsPrefix: expected.childArgs,
			cwd: expect.any(String),
		});
	});

	it("uses Bun conditions when launching the source CLI from Bun", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/Users/test/.bun/bin/bun",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgs: [
				"--conditions=development",
				"/repo/apps/cli/src/index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("uses compiled CLI subcommands without Bun flags", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/Applications/Cline/bin/cline",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "/Applications/Cline/bin/cline",
			childArgs: ["connect", "telegram", "--bot-token", "token"],
		});
	});

	it("uses Bun conditions when launching the source CLI from Node", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/usr/local/bin/node",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "bun",
			childArgs: [
				"--conditions=development",
				"/repo/apps/cli/src/index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("detects Windows Node when launching the source CLI", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "node.exe",
				cliPath: "C:\\repo\\apps\\cli\\src\\index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "bun",
			childArgs: [
				"--conditions=development",
				"C:\\repo\\apps\\cli\\src\\index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("strips terminal color codes from connector command failures", () => {
		expect(
			__test__.normalizeConnectorError(
				"\u001B[31merror:\u001B[0m error: unknown option '--conditions=development'",
				"connector start failed",
			),
		).toBe("unknown option '--conditions=development'");
	});

	it("turns Telegram unauthorized responses into a token validation message", () => {
		expect(
			__test__.normalizeConnectorError(
				"\u001B[31merror:\u001B[0m Telegram getMe failed (401 Unauthorized): Unauthorized",
				"connector start failed",
			),
		).toBe(
			"Telegram rejected this bot token. Copy the token from @BotFather and try again.",
		);
	});

	it("builds connector start arguments through the shared platform definition", () => {
		expect(
			__test__.buildConnectorStartArgs({
				channel: "telegram",
				values: { "-k": " 123456:token " },
				security: {
					enabled: true,
					values: { userId: " 987654321 " },
				},
			}),
		).toEqual([
			"telegram",
			"-k",
			"123456:token",
			"--allowed-user-id",
			"987654321",
		]);
	});

	it("uses the atomic restart command for an active connector", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], "restart"),
		).toEqual(["--restart", "telegram", "-k", "token"]);
	});

	it("starts an inactive connector directly", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], "start"),
		).toEqual(["telegram", "-k", "token"]);
	});

	it("rejects a channel-wide restart when multiple instances are active", () => {
		expect(() => __test__.resolveConnectorLaunchMode("telegram", 2)).toThrow(
			"cannot safely restart telegram: 2 instances are active",
		);
	});

	it("rejects when connector readiness times out", async () => {
		await expect(
			__test__.waitForConnectorState(() => false, 0),
		).rejects.toThrow("connector did not reach expected state within 0ms");
	});
});
