import { describe, expect, it } from "vitest";
import { __test__ } from "./connectors";

describe("connector launch command", () => {
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
});
